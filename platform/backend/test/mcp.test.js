import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

test('MCP server: tokens, buyer isolation, no secrets, confirmed drafts only', { skip: !hasTestDatabase }, async t => {
  const { db } = await testDatabase(t, 'mcp');
  await db.query(`
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES
      ('a','test-ws','a@test.invalid','A','secret-hash','buyer'), ('b','test-ws','b@test.invalid','B','secret-hash','buyer');
    INSERT INTO products(id,workspace_id,created_by,title,source_id,marketplace,engine,scrape_status)
      VALUES ('pa','test-ws','a','Product A','B000000001','fr','own','done'), ('pb','test-ws','b','Product B','B000000002','fr','own','done');
    INSERT INTO creatives(id,workspace_id,created_by,product_id,type,format,status,file_url,metadata)
      VALUES ('ca','test-ws','a','pa','image','1x1','done','/uploads/a.jpg','{"source":"local"}');
    INSERT INTO tiktok_accounts(id,workspace_id,advertiser_id,access_token,name,created_by) VALUES ('tta','test-ws','adv1','tt-secret-token','TT','a');
    INSERT INTO ap_profiles(id,workspace_id,group_name) VALUES ('apa','test-ws','a@test.invalid');
    INSERT INTO fb_accounts(id,workspace_id,ap_profile_id) VALUES ('fba','test-ws','apa');
    INSERT INTO fb_cabinets(id,workspace_id,fb_account_id,external_id,name) VALUES ('cab_a','test-ws','fba','act_111','A1');
  `);
  const fetchSaved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External requests are forbidden in MCP tests'); };
  t.after(() => { globalThis.fetch = fetchSaved; });

  const app = Fastify();
  await app.register(jwt, { secret: 'mcp-test-secret-0123456789' });
  const { registerAuthenticate } = await import('../src/middleware/authenticate.js');
  registerAuthenticate(app);
  for (const [name, exported, prefix] of [
    ['auth', 'authRoutes', 'auth'], ['products', 'productRoutes', 'products'], ['creatives', 'creativeRoutes', 'creatives'],
    ['push', 'pushRoutes', 'push'], ['scrape', 'scrapeRoutes', 'scrape'],
  ]) app.register((await import(`../src/api/routes/${name}.js`))[exported], { prefix: `/api/${prefix}` });
  const { mcpRoutes, mcpTokenRoutes } = await import('../src/api/routes/mcp.js');
  app.register(mcpTokenRoutes, { prefix: '/api/mcp-tokens' });
  app.register(mcpRoutes, { prefix: '/api/mcp' });
  await app.ready();
  t.after(() => app.close());

  const session = (id) => ({ authorization: `Bearer ${app.jwt.sign({ id })}` });
  const newToken = async (id) => {
    const r = await app.inject({ method: 'POST', url: '/api/mcp-tokens', headers: session(id), payload: { name: 'test' } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  let rpcId = 0;
  const rpc = (token, method, params = {}) => app.inject({
    method: 'POST', url: '/api/mcp',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
  const callTool = async (token, name, args = {}) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    assert.equal(r.statusCode, 200, r.body);
    const { result } = r.json();
    return { error: !!result.isError, text: result.content[0].text, data: result.isError ? null : JSON.parse(result.content[0].text) };
  };

  const ta = await newToken('a');
  const tb = await newToken('b');
  const to = await newToken('owner');

  await t.test('the token is shown once and only its hash is stored', async () => {
    assert.match(ta.token, /^bb_[A-Za-z0-9_-]{43}$/);
    const { rows } = await db.query('SELECT * FROM mcp_tokens WHERE id = $1', [ta.id]);
    assert.notEqual(rows[0].token_hash, ta.token);
    assert.ok(!JSON.stringify(rows[0]).includes(ta.token));
    const list = (await app.inject({ method: 'GET', url: '/api/mcp-tokens', headers: session('a') })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].token, undefined);
    const foreign = await app.inject({ method: 'DELETE', url: `/api/mcp-tokens/${tb.id}`, headers: session('a') });
    assert.equal(foreign.statusCode, 404, 'a buyer cannot revoke another user\'s token');
  });

  await t.test('no token, a wrong token and a revoked token get 401', async () => {
    assert.equal((await rpc(null, 'tools/list')).statusCode, 401);
    assert.equal((await rpc('bb_' + 'x'.repeat(43), 'tools/list')).statusCode, 401);
    const extra = await newToken('a');
    assert.equal((await rpc(extra.token, 'tools/list')).statusCode, 200);
    await app.inject({ method: 'DELETE', url: `/api/mcp-tokens/${extra.id}`, headers: session('a') });
    assert.equal((await rpc(extra.token, 'tools/list')).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/mcp', headers: { authorization: `Bearer ${ta.token}` } })).statusCode, 405);
  });

  await t.test('initialize returns the server instructions', async () => {
    const r = await rpc(ta.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().result.serverInfo.name, 'bananabun');
    assert.match(r.json().result.instructions, /Ничего не выдумывайте/);
  });

  await t.test('tools see exactly what the site shows this user', async () => {
    const tools = (await rpc(ta.token, 'tools/list')).json().result.tools.map(x => x.name);
    for (const name of ['whoami', 'list_products', 'get_product', 'list_creatives', 'creative_spend', 'list_pushes', 'get_push',
      'list_campaigns', 'analytics_query', 'landing_funnel', 'landing_behavior', 'scrape_product', 'generate_creatives',
      'prepare_push', 'prepare_push_batch', 'confirm', 'reject', 'check_action']) assert.ok(tools.includes(name), name);
    assert.equal((await callTool(ta.token, 'whoami')).data.user.role, 'buyer');
    assert.deepEqual((await callTool(ta.token, 'list_products')).data.items.map(p => p.id), ['pa']);
    assert.deepEqual((await callTool(tb.token, 'list_products')).data.items.map(p => p.id), ['pb']);
    assert.deepEqual((await callTool(to.token, 'list_products')).data.items.map(p => p.id).sort(), ['p', 'pa', 'pb']);
    assert.ok((await callTool(ta.token, 'get_product', { product_id: 'pb' })).error);
    assert.ok((await callTool(tb.token, 'list_creatives', { product_id: 'pa' })).error);
    assert.deepEqual((await callTool(tb.token, 'list_creatives')).data, []);
  });

  await t.test('secrets never leave through MCP', async () => {
    const { scrub } = await import('../src/api/routes/mcp.js');
    const cleaned = scrub({ access_token: 'x', nested: [{ keitaro_api_key: 'k', password_hash: 'h', proxy: 'p', remark: 'r', totp_secret: 's', ok: 1 }], title: 'kept' });
    assert.deepEqual(cleaned, { nested: [{ ok: 1 }], title: 'kept' });
    for (const name of ['whoami', 'list_products', 'list_creatives', 'list_pushes']) {
      const { text } = await callTool(to.token, name);
      for (const secret of ['tt-secret-token', 'secret-hash', ta.token, tb.token]) assert.ok(!text.includes(secret), `${name} leaks a secret`);
      assert.ok(!/password|access_token|token_hash/.test(text), `${name} leaks a secret field`);
    }
  });

  await t.test('a draft does nothing until the author confirms with the human\'s yes', async () => {
    const before = Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count);
    const d = await callTool(ta.token, 'generate_creatives', { product_id: 'pa', count: 2, format: '1x1' });
    assert.ok(!d.error, d.text);
    assert.match(d.data.card, /\| Настройка \| Значение \|/);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count), before, 'nothing is created by a draft');

    assert.ok((await callTool(ta.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'покажи ещё раз' })).error, 'not a yes');
    assert.ok((await callTool(ta.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'да, но не сейчас' })).error, 'a hedged yes is not a yes');
    assert.ok((await callTool(tb.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'да' })).error, 'another user cannot confirm');
    assert.equal((await db.findOne('mcp_drafts', { id: d.data.draft_id })).status, 'pending');

    const ok = await callTool(ta.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'да' });
    assert.ok(!ok.error, ok.text);
    assert.equal(ok.data.result.total, 2);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count), before + 2);
    assert.ok((await callTool(ta.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'да' })).error, 'a draft runs once');
    const check = await callTool(ta.token, 'check_action', { draft_id: d.data.draft_id });
    assert.equal(check.data.items.length, 2);
    assert.ok(['running', 'done', 'failed', 'partial'].includes(check.data.status));
  });

  await t.test('expired and rejected drafts are refused; a foreign product cannot be drafted', async () => {
    const d = await callTool(ta.token, 'generate_creatives', { product_id: 'pa', count: 1 });
    await db.query("UPDATE mcp_drafts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [d.data.draft_id]);
    assert.ok((await callTool(ta.token, 'confirm', { draft_id: d.data.draft_id, human_reply: 'да' })).error);
    const r = await callTool(ta.token, 'generate_creatives', { product_id: 'pa', count: 1 });
    assert.ok(!(await callTool(ta.token, 'reject', { draft_id: r.data.draft_id })).error);
    assert.ok((await callTool(ta.token, 'confirm', { draft_id: r.data.draft_id, human_reply: 'да' })).error);
    assert.ok((await callTool(ta.token, 'generate_creatives', { product_id: 'pb', count: 1 })).error);
    assert.ok((await callTool(ta.token, 'scrape_product', { links: ['not a link'] })).error);
  });

  await t.test('a push draft needs budget and bid and is validated like the site', async () => {
    const base = { product_id: 'pa', creative_ids: ['ca'], cabinet_external_id: 'act_111', pixel_id: '999' };
    const pushesBefore = Number((await db.query('SELECT COUNT(*) FROM pushes')).rows[0].count);
    assert.ok((await callTool(ta.token, 'prepare_push', base)).error, 'no budget and bid');
    assert.ok((await callTool(ta.token, 'prepare_push', { ...base, daily_budget: 0, bid_amount: 1 })).error, 'zero budget');
    const foreign = await callTool(ta.token, 'prepare_push', { ...base, cabinet_external_id: 'act_999', daily_budget: 20, bid_amount: 1 });
    assert.match(foreign.text, /не ваш кабинет/, 'a cabinet outside the team');
    const d = await callTool(ta.token, 'prepare_push', { ...base, daily_budget: 20, bid_amount: 1.5 });
    assert.ok(!d.error, d.text);
    assert.match(d.data.card, /на паузе/);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM pushes')).rows[0].count), pushesBefore, 'a draft writes no push');
    const batch = await callTool(ta.token, 'prepare_push_batch', { product_id: 'pa', creative_ids: ['ca'],
      cabinets: [{ cabinet_external_id: 'act_111', pixel_id: '999', daily_budget: 20, bid_amount: 1 }] });
    assert.ok(!batch.error, batch.text);
  });
});
