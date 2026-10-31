import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

test('Telegram bot: linking, webhook secret, recipients, queue, postbacks', { skip: !hasTestDatabase }, async t => {
  const { db } = await testDatabase(t, 'telegram');
  await db.query(`
    INSERT INTO users(id,workspace_id,email,name,password_hash,role,keitaro_tag) VALUES
      ('a','test-ws','a@test.invalid','Anna','x','buyer','anna'), ('b','test-ws','b@test.invalid','Boris','x','buyer','boris'),
      ('c','test-ws','c@test.invalid','Carl','x','buyer',NULL), ('lead','test-ws','lead@test.invalid','Lena','x','lead',NULL),
      ('twin','test-ws','twin@test.invalid','Anna','x','buyer','twin');
    INSERT INTO workspaces(id,name) VALUES ('other-ws','Other');
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES ('o2','other-ws','o2@test.invalid','Olga','x','owner');
  `);
  const envSaved = { ...process.env };
  t.after(() => { for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'KEITARO_POSTBACK_SECRET']) { if (envSaved[k] === undefined) delete process.env[k]; else process.env[k] = envSaved[k]; } });
  delete process.env.TELEGRAM_BOT_TOKEN;

  // Telegram is never reached: every Bot API call is answered here and recorded.
  const calls = [];
  let answer = () => ({ ok: true, result: { message_id: 1 } });
  const fetchSaved = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.startsWith('https://api.telegram.org/')) throw new Error(`Unexpected request: ${u}`);
    const method = u.split('/').pop();
    const body = JSON.parse(opts?.body || '{}');
    calls.push({ method, body });
    const res = method === 'getMe' ? { ok: true, result: { username: 'bb_test_bot', first_name: 'BB' } } : answer(method, body);
    return { ok: res.ok, status: res.ok ? 200 : res.error_code, json: async () => res };
  };
  t.after(() => { globalThis.fetch = fetchSaved; });

  const tg = await import('../src/services/telegram.js');
  const app = Fastify();
  await app.register(jwt, { secret: 'telegram-test-secret-0123456789' });
  (await import('../src/middleware/authenticate.js')).registerAuthenticate(app);
  app.register((await import('../src/api/routes/telegram.js')).telegramRoutes, { prefix: '/api/telegram' });
  await app.ready();
  t.after(() => app.close());
  const as = (id) => ({ authorization: `Bearer ${app.jwt.sign({ id })}` });
  const outbox = async () => (await db.query('SELECT * FROM telegram_outbox ORDER BY id')).rows;

  await t.test('without a token nothing is queued, sent or broken', async () => {
    assert.equal(await tg.notify('push_failed', { workspace_id: 'test-ws', owner_user_id: 'a', payload: {} }), 0);
    assert.equal(await tg.processOutbox(), 0);
    const me = await app.inject({ method: 'GET', url: '/api/telegram/me', headers: as('a') });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().bot_ready, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/telegram/me/link', headers: as('a') })).statusCode, 503);
    assert.equal(calls.length, 0);
  });

  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST-token-not-real';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret-0123456789';
  const hook = (secret, text, chatId) => app.inject({ method: 'POST', url: '/api/telegram/webhook',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    payload: { update_id: 1, message: { text, chat: { id: chatId, type: 'private' }, from: { username: 'u' + chatId } } } });
  const codeOf = async (user) => {
    const r = await app.inject({ method: 'POST', url: '/api/telegram/me/link', headers: as(user) });
    assert.equal(r.statusCode, 200, r.body);
    assert.match(r.json().url, /^https:\/\/t\.me\/bb_test_bot\?start=/);
    return new URL(r.json().url).searchParams.get('start');
  };

  await t.test('the webhook refuses a missing or wrong secret', async () => {
    assert.equal((await hook(null, '/help', 1)).statusCode, 401);
    assert.equal((await hook('wrong', '/help', 1)).statusCode, 401);
    assert.equal((await hook('hook-secret-0123456789', '/help', 1)).statusCode, 200);
  });

  await t.test('a link code works once and only within 15 minutes', async () => {
    const code = await codeOf('a');
    assert.equal((await hook('hook-secret-0123456789', `/start ${code}`, 1001)).statusCode, 200);
    assert.equal((await db.query("SELECT chat_id FROM telegram_links WHERE user_id='a'")).rows[0].chat_id, '1001');
    await hook('hook-secret-0123456789', `/start ${code}`, 2002);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM telegram_links WHERE chat_id = 2002")).rows[0].n, 0, 'a used code does not link another chat');
    const old = await codeOf('b');
    await db.query("UPDATE telegram_link_codes SET expires_at = NOW() - INTERVAL '1 minute'");
    await hook('hook-secret-0123456789', `/start ${old}`, 2002);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM telegram_links WHERE user_id = 'b'")).rows[0].n, 0, 'an expired code does not link');
    await hook('hook-secret-0123456789', `/start ${await codeOf('b')}`, 2002);
    await hook('hook-secret-0123456789', `/start ${await codeOf('owner')}`, 3003);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM telegram_links')).rows[0].n, 3);
  });

  await t.test('a buyer gets only events about their own objects; owner gets team copies', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await tg.notify('push_failed', { workspace_id: 'test-ws', owner_user_id: 'b', dedupe_key: 'pf1', payload: { title: 'B push', error: 'x' } });
    await tg.notify('push_done', { workspace_id: 'test-ws', owner_user_id: 'b', dedupe_key: 'pd1', payload: { title: 'B push' } });
    const rows = await outbox();
    assert.deepEqual(rows.map(r => `${r.event}:${r.user_id}`).sort(), ['push_done:b', 'push_failed:b', 'push_failed:owner']);
    assert.ok(!rows.some(r => r.user_id === 'a'), 'buyer A never hears about buyer B');
    await tg.notify('agent_offline', { workspace_id: 'test-ws', dedupe_key: 'ao1', payload: { minutes: 20 } });
    assert.deepEqual((await outbox()).filter(r => r.event === 'agent_offline').map(r => r.user_id), ['owner'], 'agent alerts go to owner/lead only');
  });

  await t.test('one event, one message', async () => {
    await db.query('DELETE FROM telegram_outbox');
    for (let i = 0; i < 3; i++) await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'same', payload: { error: 'x' } });
    assert.equal((await outbox()).length, 1);
  });

  await t.test('429 waits retry_after; 403 unlinks the blocked chat', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'r429', payload: { error: 'x' } });
    answer = () => ({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 30 } });
    const now = Date.now() + 10_000;
    await tg.processOutbox({ now });
    let [m] = await outbox();
    assert.equal(m.status, 'pending');
    assert.ok(new Date(m.next_at).getTime() >= now + 29_000, 'next try after retry_after');
    answer = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    await tg.processOutbox({ now: now + 31_000 });
    [m] = await outbox();
    assert.equal(m.status, 'failed');
    assert.ok((await db.query("SELECT blocked_at FROM telegram_links WHERE user_id='a'")).rows[0].blocked_at);
    answer = () => ({ ok: true, result: { message_id: 2 } });
    await db.query("UPDATE telegram_links SET blocked_at = NULL WHERE user_id='a'");
  });

  await t.test('messages never carry secrets', async () => {
    const text = tg.messageFor('push_failed', { title: 'x', error: 'Graph error token EAAGm0PX4ZCpsBAKZCZBabc123 and key 0123456789abcdef0123456789abcdef' });
    assert.ok(!/EAAGm0PX4ZCps/.test(text) && !/0123456789abcdef0123456789abcdef/.test(text));
    assert.ok(!tg.messageFor('broadcast', { text: '<script>' }).includes('<script>'), 'HTML is escaped');
  });

  await t.test('Keitaro postbacks: only the team secret, click_id required, duplicates once, a buyer gets only their own', async () => {
    process.env.KEITARO_POSTBACK_SECRET = 'pb-secret-abcdef0123456789';
    await db.query('DELETE FROM telegram_outbox');
    const pbr = await app.inject({ method: 'GET', url: '/api/telegram/admin/postbacks', headers: as('owner') });
    assert.equal(pbr.statusCode, 200, pbr.body);
    const secret = new URL(pbr.json().url).pathname.split('/').pop();
    assert.ok(!pbr.json().url.includes('ws='), 'the URL does not name the team');
    const send = (sec, q) => app.inject({ method: 'GET', url: `/api/telegram/keitaro-postback/${sec}?${q}` });
    assert.equal((await send('pb-secret-abcdef0123456789', 'status=sale&click_id=old')).statusCode, 404, 'the old shared secret is no longer accepted');
    assert.equal((await send('wrong-secret-0123456789', 'status=sale&click_id=w')).statusCode, 404);
    assert.equal((await send(secret, 'status=sale&campaign_name=x')).statusCode, 400, 'click_id is required');
    // Another team's secret with ws=test-ws: the team comes from the secret, so it lands in the other team.
    const otherSecret = await tg.postbackSecretFor('other-ws');
    assert.equal((await send(otherSecret, 'ws=test-ws&status=sale&campaign_name=%5Banna%5D%20Spoof&click_id=sp1')).statusCode, 200);
    const anna = 'status=sale&payout=25&currency=EUR&campaign_name=%5Banna%5D%20Kettle&click_id=c1';
    assert.equal((await send(secret, anna)).statusCode, 200);
    assert.equal((await send(secret, anna)).statusCode, 200);
    const form = await app.inject({ method: 'POST', url: `/api/telegram/keitaro-postback/${secret}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'status=lead&campaign_name=%5Bboris%5D%20Fan&click_id=c2' });
    assert.equal(form.statusCode, 200, 'Keitaro may POST a form');
    for (let i = 0; i < 50 && (await db.query('SELECT COUNT(*)::int AS n FROM telegram_postbacks')).rows[0].n < 4; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 50));
    assert.equal((await db.query("SELECT workspace_id FROM telegram_postbacks WHERE click_id = 'sp1'")).rows[0].workspace_id, 'other-ws');
    const rows = await outbox();
    assert.ok(!rows.some(r => r.text.includes('Spoof')), 'another team cannot put conversions into this team');
    assert.deepEqual(rows.map(r => `${r.event}:${r.user_id}`).sort(), ['conversion:a', 'conversion:b', 'conversion:owner', 'conversion:owner']);
    assert.equal(rows.filter(r => r.user_id === 'a').length, 1, 'a repeated postback is one message');
    assert.ok(rows.find(r => r.user_id === 'a').text.includes('Kettle'));
    assert.ok(!rows.find(r => r.user_id === 'a').text.includes('Fan'), 'buyer A gets no conversion of buyer B');
    const pb = await app.inject({ method: 'GET', url: '/api/telegram/admin/postbacks', headers: as('owner') });
    assert.equal(pb.json().counts.total, 3);
    assert.equal(pb.json().counts.duplicates, 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/telegram/admin/postbacks', headers: as('a') })).statusCode, 403);
    const rot = await app.inject({ method: 'POST', url: '/api/telegram/admin/postbacks/rotate', headers: as('owner'), payload: { confirm: true } });
    assert.equal(rot.statusCode, 200);
    assert.equal((await send(secret, 'status=sale&click_id=after')).statusCode, 404, 'a replaced secret stops working');
    assert.ok(tg.postbackClickId({ click_id: 'x'.repeat(400) }).length <= 70, 'a long click_id is hashed');
  });

  await t.test('the request log masks the postback secret', async () => {
    const { redactUrl, reqSerializer } = await import('../src/services/log-redact.js');
    assert.equal(redactUrl('/api/telegram/keitaro-postback/SeCrEt_123456789012?status=sale'), '/api/telegram/keitaro-postback/•••?status=sale');
    assert.ok(!reqSerializer({ method: 'GET', url: '/banana/api/telegram/keitaro-postback/abcdefabcdefabcdef', socket: {} }).url.includes('abcdef'));
  });

  await t.test('admin pages are owner/lead only and mask chats', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/telegram/admin/members', headers: as('a') })).statusCode, 403);
    const m = await app.inject({ method: 'GET', url: '/api/telegram/admin/members', headers: as('owner') });
    assert.equal(m.statusCode, 200);
    const a = m.json().find(u => u.id === 'a');
    assert.equal(a.chat_id, undefined);
    assert.ok(a.linked && a.chat.startsWith('•••'));
    assert.ok(!JSON.stringify(m.json()).includes('"1001"'));
    const s = await app.inject({ method: 'PUT', url: '/api/telegram/admin/settings', headers: as('owner'), payload: { digest_hour: 25 } });
    assert.equal(s.statusCode, 400);
  });
  await t.test('member links: only for someone without Telegram; a lead not for the owner or other leads', async () => {
    const link = (by, id) => app.inject({ method: 'POST', url: `/api/telegram/admin/members/${id}/link`, headers: as(by), payload: {} });
    const own = await link('owner', 'c');
    assert.equal(own.statusCode, 200, own.body);
    assert.match(own.json().url, /^https:\/\/t\.me\/bb_test_bot\?start=[A-Za-z0-9_-]+$/);
    assert.equal((await link('owner', 'b')).statusCode, 409, 'an already linked member is not relinked by someone else');
    assert.equal((await link('lead', 'owner')).statusCode, 403, 'a lead cannot take over the owner');
    assert.equal((await link('lead', 'c')).statusCode, 200);
    assert.equal((await link('a', 'c')).statusCode, 403);
    assert.equal((await link('owner', 'nobody')).statusCode, 404);
    const m = await app.inject({ method: 'GET', url: '/api/telegram/admin/members', headers: as('owner') });
    assert.equal(m.json().find(u => u.id === 'c').no_keitaro_tag, true, 'a buyer without a Keitaro nickname is flagged');
    assert.equal(m.json().find(u => u.id === 'a').no_keitaro_tag, false);
  });

  await t.test('relinking an account tells the old chat', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await hook('hook-secret-0123456789', `/start ${await codeOf('c')}`, 6006);
    await hook('hook-secret-0123456789', `/start ${await codeOf('c')}`, 7007);
    assert.equal((await db.query("SELECT chat_id FROM telegram_links WHERE user_id='c'")).rows[0].chat_id, '7007');
    const [r] = (await outbox()).filter(m => m.event === 'relinked');
    assert.ok(r && String(r.chat_id) === '6006', 'the old chat gets the warning');
    calls.length = 0;
    await tg.processOutbox({ now: Date.now() + 5000 });
    assert.ok(calls.some(c => c.method === 'sendMessage' && String(c.body.chat_id) === '6006'));
    await db.query("DELETE FROM telegram_links WHERE user_id='c'");
  });

  const press = (chatId, data, fromId = chatId) => app.inject({ method: 'POST', url: '/api/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': 'hook-secret-0123456789' },
    payload: { update_id: 9, callback_query: { id: 'cb' + data, from: { id: fromId }, data, message: { message_id: 77, chat: { id: chatId, type: 'private' } } } } });

  await t.test('a button toggles the event for that person and edits the same message', async () => {
    calls.length = 0;
    assert.equal((await press(1001, 't:scrape_done')).statusCode, 200);
    const [p] = (await db.query("SELECT enabled FROM telegram_prefs WHERE user_id='a' AND event='scrape_done'")).rows;
    assert.equal(p.enabled, true, 'scrape_done is off by default, the press turns it on');
    const edit = calls.find(c => c.method === 'editMessageText');
    assert.ok(edit && String(edit.body.chat_id) === '1001' && edit.body.message_id === 77);
    assert.ok(edit.body.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 't:scrape_done' && b.text.startsWith('✅')));
    assert.ok(calls.some(c => c.method === 'answerCallbackQuery'));
    assert.ok(edit.body.reply_markup.inline_keyboard.flat().every(b => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64));
    await press(1001, 'tv:spend_over:2');
    const [th] = (await db.query("SELECT threshold FROM telegram_prefs WHERE user_id='a' AND event='spend_over'")).rows;
    assert.equal(th.threshold.amount, 100);
  });

  await t.test('buttons from a foreign or unlinked chat change nothing', async () => {
    const before = (await db.query('SELECT COUNT(*)::int AS n FROM telegram_prefs')).rows[0].n;
    calls.length = 0;
    await press(5555, 't:creatives_done');
    await press(1001, 't:creatives_done', 4444);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM telegram_prefs')).rows[0].n, before);
    assert.ok(!calls.some(c => c.method === 'editMessageText'));
    assert.equal(calls.filter(c => c.method === 'answerCallbackQuery' && c.body.show_alert).length, 2);
    await press(1001, 't:agent_offline');
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM telegram_prefs WHERE user_id='a' AND event='agent_offline'")).rows[0].n, 0, 'a buyer cannot switch lead-only events');
    calls.length = 0;
    await press(1001, 't:3');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM telegram_prefs')).rows[0].n, before, 'an old index button changes nothing');
    assert.match(calls.find(c => c.method === 'answerCallbackQuery').body.text, /settings/);
  });

  await t.test('outside the window non-urgent messages wait and leave as one; urgent ones go at once', async () => {
    await db.query('DELETE FROM telegram_outbox');
    const h = new Date().getUTCHours();
    const r = await app.inject({ method: 'PUT', url: '/api/telegram/me/schedule', headers: as('a'),
      payload: { deliver_from: (h + 2) % 24, deliver_to: (h + 3) % 24, timezone: 'UTC' } });
    assert.equal(r.statusCode, 200, r.body);
    await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'w1', payload: { error: 'one' } });
    await tg.notify('push_failed', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'w2', payload: { title: 'two', error: 'x' } });
    await tg.notify('conversion', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'w3', urgent: true, payload: { status: 'sale' } });
    const rows = (await outbox()).filter(m => m.user_id === 'a');
    const held = rows.filter(m => m.held);
    assert.equal(held.length, 2);
    assert.ok(held.every(m => new Date(m.next_at).getTime() > Date.now() + 60 * 60000), 'held until the window opens');
    assert.ok(!rows.find(m => m.event === 'conversion').held);
    calls.length = 0;
    const later = new Date(held[0].next_at).getTime() + 120_000;
    await tg.processOutbox({ now: later });
    const toA = calls.filter(c => c.method === 'sendMessage' && String(c.body.chat_id) === '1001');
    assert.equal(toA.length, 1, 'the urgent one first; the held ones go out on the next second');
    await tg.processOutbox({ now: later + 2000 });
    const all = calls.filter(c => c.method === 'sendMessage' && String(c.body.chat_id) === '1001');
    assert.equal(all.length, 2);
    assert.match(all[1].body.text, /Накопилось/);
    assert.ok(all[1].body.text.includes('one') && all[1].body.text.includes('two'));
    assert.equal((await outbox()).filter(m => m.user_id === 'a' && m.status === 'sent').length, 3);
    assert.equal(all[0].body.reply_markup.inline_keyboard[0][0].callback_data, 's', 'every message carries the settings button');
    await app.inject({ method: 'PUT', url: '/api/telegram/me/schedule', headers: as('a'), payload: { deliver_from: null, deliver_to: null } });
    assert.equal((await app.inject({ method: 'PUT', url: '/api/telegram/me/schedule', headers: as('a'), payload: { deliver_from: 9 } })).statusCode, 400);
  });

  await t.test('a personal time zone moves the window', async () => {
    const at = new Date(Date.UTC(2026, 9, 31, 1, 30));
    assert.equal(tg.inWindow({ from: 9, to: 10, timezone: 'Asia/Makassar' }, 'UTC', at), true, '01:30 UTC is 09:30 in Makassar');
    assert.equal(tg.inWindow({ from: 9, to: 10 }, 'UTC', at), false);
    assert.equal(tg.inWindow({ from: 22, to: 2 }, 'UTC', at), true, 'a window across midnight');
    assert.equal(tg.digestDue({ timezone: 'Asia/Makassar', digest_hour: 9 }, { timezone: 'UTC', digest_hour: 22 }, at), '2026-10-31');
  });

  await t.test('the webhook asks for button presses and an old webhook is fixed by itself', async () => {
    calls.length = 0;
    const r = await app.inject({ method: 'POST', url: '/api/telegram/admin/webhook', headers: as('owner'), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(calls.find(c => c.method === 'setWebhook').body.allowed_updates, ['message', 'callback_query']);
    const saved = answer;
    answer = (method) => method === 'getWebhookInfo' ? { ok: true, result: { url: tg.webhookUrl(), allowed_updates: ['message'] } } : { ok: true, result: true };
    calls.length = 0;
    assert.equal(await tg.ensureWebhookUpdates(), true);
    assert.deepEqual(calls.find(c => c.method === 'setWebhook').body.allowed_updates, ['message', 'callback_query']);
    answer = (method) => method === 'getWebhookInfo' ? { ok: true, result: { url: tg.webhookUrl(), allowed_updates: ['message', 'callback_query'] } } : { ok: true, result: true };
    calls.length = 0;
    assert.equal(await tg.ensureWebhookUpdates(), false);
    assert.ok(!calls.some(c => c.method === 'setWebhook'));
    answer = saved;
  });

  await t.test('a network or 5xx failure retries for up to a day; a bad request fails at once', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await db.query('UPDATE telegram_links SET muted = false, blocked_at = NULL');
    const saved = answer;
    answer = (m) => (m === 'sendMessage' ? { ok: false, error_code: 502, description: 'Bad Gateway' } : { ok: true, result: true });
    await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'b', dedupe_key: 'net1', payload: { error: 'x' } });
    let now = Date.now() + 100_000;
    for (let i = 0; i < 7; i++) {
      await tg.processOutbox({ now });
      const [m] = await outbox();
      now = new Date(m.next_at).getTime() + 1500;
    }
    let [m] = await outbox();
    assert.equal(m.status, 'pending', 'still trying after 7 failures');
    assert.ok(m.attempts >= 7);
    answer = (meth) => { if (meth === 'sendMessage') throw new Error('ECONNRESET'); return { ok: true, result: true }; };
    await tg.processOutbox({ now });
    [m] = await outbox();
    assert.equal(m.status, 'pending', 'a dropped connection is retried too');
    now = new Date(m.next_at).getTime() + 1500;
    await db.query("UPDATE telegram_outbox SET created_at = NOW() - INTERVAL '25 hours'");
    await tg.processOutbox({ now });
    [m] = await outbox();
    assert.equal(m.status, 'failed');
    assert.match(m.error, /сутки/);
    answer = (meth) => (meth === 'sendMessage' ? { ok: false, error_code: 400, description: 'Bad Request: chat not found' } : { ok: true, result: true });
    await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'b', dedupe_key: 'bad1', payload: { error: 'x' } });
    await tg.processOutbox({ now: now + 2000 });
    assert.equal((await outbox()).find(r => r.dedupe_key.startsWith('bad1')).status, 'failed');
    answer = saved;
  });

  await t.test('a paused or unlinked person gets nothing that was queued before', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await tg.notify('scrape_failed', { workspace_id: 'test-ws', owner_user_id: 'b', dedupe_key: 'mute1', payload: { error: 'x' } });
    await db.query("UPDATE telegram_links SET muted = true WHERE user_id = 'b'");
    calls.length = 0;
    await tg.processOutbox({ now: Date.now() + 4_000_000 });
    assert.equal((await outbox())[0].status, 'skipped');
    assert.ok(!calls.some(c => c.method === 'sendMessage'));
    await db.query("UPDATE telegram_links SET muted = false WHERE user_id = 'b'");
  });

  await t.test('two workers never send the same message twice', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await tg.notify('push_failed', { workspace_id: 'test-ws', owner_user_id: 'a', dedupe_key: 'dc1', payload: { title: 'x', error: 'y' } });
    calls.length = 0;
    const now = Date.now() + 50_000_000; // past every per-chat send time the earlier tests left behind
    await Promise.all([tg.processOutbox({ now }), tg.processOutbox({ now })]);
    const rows = await outbox();
    assert.equal(rows.length, 2, 'the author and the owner');
    assert.equal(calls.filter(c => c.method === 'sendMessage').length, rows.length);
    assert.ok(rows.every(r => r.status === 'sent'));
  });

  await t.test('the digest and /status match a buyer by member id, never by name', async () => {
    const client = { stats: async () => ({ rows: [
      { sub_id_2: '', campaign: '[anna] Kettle', campaign_group: '', clicks: 10, lp_clicks: 0, sales: 1, leads: 0, revenue: 100, cost: 40 },
      { sub_id_2: '', campaign: '[twin] Toaster', campaign_group: '', clicks: 5, lp_clicks: 0, sales: 0, leads: 0, revenue: 0, cost: 30 },
    ] }) };
    const today = await tg.buyerPeriod('test-ws', client, 'today');
    assert.deepEqual(today.map(r => r.userId).sort(), ['a', 'twin'], 'two members named Anna stay apart');
    const d = tg.digestFor({ id: 'a', role: 'buyer' }, today, today, '2026-10-31');
    assert.equal(d.rows.length, 1);
    assert.equal(d.total.cost, 40);
    assert.equal(d.total.share, 21, '35% of a profit of 60');
    const text = tg.messageFor('daily_digest', d);
    assert.match(text, /с 00:00 до/);
    assert.match(text, /время трекера/);
    assert.match(text, /Вчера целиком/);
    assert.ok(!text.includes('30,00'), 'the other Anna is not mixed in');
    const team = tg.digestFor({ id: 'owner', role: 'owner' }, today, null, '2026-10-31');
    assert.equal(team.rows.length, 2);
  });

  await t.test('money alerts: spend today and ROI for yesterday from the tracker, owned campaigns only, ROI once a day', async () => {
    await db.query('DELETE FROM telegram_outbox');
    const h = new Date().getUTCHours();
    let o = (10 - h + 24) % 24;
    if (o > 14) o -= 24;
    const tz = o === 0 ? 'UTC' : `Etc/GMT${o > 0 ? '-' : '+'}${Math.abs(o)}`;
    await db.query("UPDATE telegram_links SET timezone = $1 WHERE user_id = 'a'", [tz]);
    const row = (id, campaign, cost, revenue, clicks) => ({ campaign_id: id, campaign, campaign_group: '', sub_id_2: '', clicks, lp_clicks: 0, sales: 0, leads: 0, revenue, cost });
    const client = { stats: async (range) => ({ rows: range === 'yesterday'
      ? [row(1, '[anna] Bad', 100, 10, 50), row(3, '[nobody] Orphan', 500, 0, 100), row(4, '[anna] Tiny', 100, 0, 3)]
      : [row(2, '[anna] Spendy', 150, 0, 20), row(3, '[nobody] Orphan', 900, 0, 100)] }) };
    const s = await tg.workspaceSettings('test-ws');
    await tg.checkMoney('test-ws', s, client);
    await tg.checkMoney('test-ws', s, client);
    const rows = await outbox();
    const roi = rows.filter(r => r.event === 'roi_below');
    assert.equal(roi.length, 1, 'once a day, and not for a campaign with too few clicks');
    assert.ok(roi[0].text.includes('Bad') && roi[0].text.includes('вчера'));
    assert.equal(rows.filter(r => r.event === 'spend_over').length, 1, 'spend over the threshold of 100 set by the button');
    assert.ok(rows.find(r => r.event === 'spend_over').text.includes('по трекеру'));
    assert.ok(rows.every(r => r.user_id === 'a'), 'campaigns without a member never reach leads');
    await db.query("UPDATE telegram_links SET timezone = NULL WHERE user_id = 'a'");
  });

  await t.test('after an outage alert the agent coming back is reported once', async () => {
    await db.query('DELETE FROM telegram_outbox');
    await db.query("UPDATE workspaces SET agent_key_hash = 'x', agent_seen_at = NOW() - INTERVAL '30 minutes' WHERE id = 'test-ws'");
    const s = await tg.workspaceSettings('test-ws');
    await tg.checkAgent('test-ws', s);
    assert.ok((await outbox()).some(r => r.event === 'agent_offline'));
    await db.query("UPDATE workspaces SET agent_seen_at = NOW() + INTERVAL '1 second' WHERE id = 'test-ws'");
    await tg.checkAgent('test-ws', s);
    const first = (await outbox()).filter(r => r.event === 'agent_online').length;
    await tg.checkAgent('test-ws', s);
    const on = (await outbox()).filter(r => r.event === 'agent_online');
    assert.ok(first >= 1);
    assert.equal(on.length, first, 'one message per episode');
    assert.ok(on.every(r => r.user_id === 'owner' || r.user_id === 'lead'));
  });
});
