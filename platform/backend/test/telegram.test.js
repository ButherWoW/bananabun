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
});
