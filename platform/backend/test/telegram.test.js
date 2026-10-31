import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

test('Telegram bot: linking, webhook secret, recipients, queue, postbacks', { skip: !hasTestDatabase }, async t => {
  const { db } = await testDatabase(t, 'telegram');
  await db.query(`
    INSERT INTO users(id,workspace_id,email,name,password_hash,role,keitaro_tag) VALUES
      ('a','test-ws','a@test.invalid','Anna','x','buyer','anna'), ('b','test-ws','b@test.invalid','Boris','x','buyer','boris');
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

  await t.test('Keitaro postbacks: secret required, duplicates once, a buyer gets only their own conversions', async () => {
    process.env.KEITARO_POSTBACK_SECRET = 'pb-secret-abcdef0123456789';
    await db.query('DELETE FROM telegram_outbox');
    assert.equal((await app.inject({ method: 'GET', url: '/api/telegram/keitaro-postback/wrong?ws=test-ws&status=sale' })).statusCode, 404);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM telegram_postbacks')).rows[0].n, 0);
    const send = (q) => app.inject({ method: 'GET', url: `/api/telegram/keitaro-postback/pb-secret-abcdef0123456789?ws=test-ws&${q}` });
    const anna = 'status=sale&payout=25&currency=EUR&campaign_name=%5Banna%5D%20Kettle&click_id=c1';
    assert.equal((await send(anna)).statusCode, 200);
    assert.equal((await send(anna)).statusCode, 200);
    const form = await app.inject({ method: 'POST', url: '/api/telegram/keitaro-postback/pb-secret-abcdef0123456789',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'ws=test-ws&status=lead&campaign_name=%5Bboris%5D%20Fan&click_id=c2' });
    assert.equal(form.statusCode, 200, 'Keitaro may POST a form');
    for (let i = 0; i < 50 && (await db.query('SELECT COUNT(*)::int AS n FROM telegram_postbacks')).rows[0].n < 3; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 50));
    const rows = await outbox();
    assert.deepEqual(rows.map(r => `${r.event}:${r.user_id}`).sort(), ['conversion:a', 'conversion:b', 'conversion:owner', 'conversion:owner']);
    assert.equal(rows.filter(r => r.user_id === 'a').length, 1, 'a repeated postback is one message');
    assert.ok(rows.find(r => r.user_id === 'a').text.includes('Kettle'));
    assert.ok(!rows.find(r => r.user_id === 'a').text.includes('Fan'), 'buyer A gets no conversion of buyer B');
    const pb = await app.inject({ method: 'GET', url: '/api/telegram/admin/postbacks', headers: as('owner') });
    assert.equal(pb.json().counts.total, 3);
    assert.equal(pb.json().counts.duplicates, 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/telegram/admin/postbacks', headers: as('a') })).statusCode, 403);
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
  await t.test('owner gets a one-time link for a member of the team only', async () => {
    const own = await app.inject({ method: 'POST', url: '/api/telegram/admin/members/b/link', headers: as('owner'), payload: {} });
    assert.equal(own.statusCode, 200, own.body);
    assert.match(own.json().url, /^https:\/\/t\.me\/bb_test_bot\?start=[A-Za-z0-9_-]+$/);
    assert.equal((await app.inject({ method: 'POST', url: '/api/telegram/admin/members/b/link', headers: as('a'), payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/telegram/admin/members/nobody/link', headers: as('owner'), payload: {} })).statusCode, 404);
  });

  const press = (chatId, data, fromId = chatId) => app.inject({ method: 'POST', url: '/api/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': 'hook-secret-0123456789' },
    payload: { update_id: 9, callback_query: { id: 'cb' + data, from: { id: fromId }, data, message: { message_id: 77, chat: { id: chatId, type: 'private' } } } } });

  await t.test('a button toggles the event for that person and edits the same message', async () => {
    const i = tg.EVENT_KEYS.indexOf('scrape_done');
    calls.length = 0;
    assert.equal((await press(1001, `t:${i}`)).statusCode, 200);
    const [p] = (await db.query("SELECT enabled FROM telegram_prefs WHERE user_id='a' AND event='scrape_done'")).rows;
    assert.equal(p.enabled, true, 'scrape_done is off by default, the press turns it on');
    const edit = calls.find(c => c.method === 'editMessageText');
    assert.ok(edit && String(edit.body.chat_id) === '1001' && edit.body.message_id === 77);
    assert.ok(edit.body.reply_markup.inline_keyboard.flat().some(b => b.callback_data === `t:${i}` && b.text.startsWith('✅')));
    assert.ok(calls.some(c => c.method === 'answerCallbackQuery'));
    assert.ok(edit.body.reply_markup.inline_keyboard.flat().every(b => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64));
    const ti = tg.EVENT_KEYS.indexOf('spend_over');
    await press(1001, `tv:${ti}:2`);
    const [th] = (await db.query("SELECT threshold FROM telegram_prefs WHERE user_id='a' AND event='spend_over'")).rows;
    assert.equal(th.threshold.amount, 100);
  });

  await t.test('buttons from a foreign or unlinked chat change nothing', async () => {
    const before = (await db.query('SELECT COUNT(*)::int AS n FROM telegram_prefs')).rows[0].n;
    const i = tg.EVENT_KEYS.indexOf('creatives_done');
    calls.length = 0;
    await press(5555, `t:${i}`);
    await press(1001, `t:${i}`, 4444);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM telegram_prefs')).rows[0].n, before);
    assert.ok(!calls.some(c => c.method === 'editMessageText'));
    assert.equal(calls.filter(c => c.method === 'answerCallbackQuery' && c.body.show_alert).length, 2);
    const agent = tg.EVENT_KEYS.indexOf('agent_offline');
    await press(1001, `t:${agent}`);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM telegram_prefs WHERE user_id='a' AND event='agent_offline'")).rows[0].n, 0, 'a buyer cannot switch lead-only events');
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
});
