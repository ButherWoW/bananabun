import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { registerHardening } from '../src/hardening.js';
import { settleFastScrape } from '../src/services/scrape-jobs.js';
import { db } from '../src/db/client.js';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

async function app(t, routes) {
  const a = Fastify();
  registerHardening(a);
  routes(a);
  t.after(() => a.close());
  await a.ready();
  return a;
}

test('database error text never reaches the client, 4xx keep their message', async (t) => {
  const a = await app(t, (f) => {
    f.get('/db', async () => { throw Object.assign(new Error('new row for relation "products" violates check constraint "products_status_check"'), { code: '23514' }); });
    f.get('/nf', async () => { throw Object.assign(new Error('Not found'), { statusCode: 404 }); });
    f.get('/gw', async () => { throw Object.assign(new Error('upstream detail'), { statusCode: 502 }); });
  });
  const db500 = await a.inject({ url: '/db' });
  assert.equal(db500.statusCode, 500);
  assert.doesNotMatch(db500.body, /products|constraint|23514/);
  assert.equal(db500.json().message, 'Внутренняя ошибка сервера');
  const nf = await a.inject({ url: '/nf' });
  assert.equal(nf.statusCode, 404);
  assert.deepEqual(nf.json(), { statusCode: 404, error: 'Not Found', message: 'Not found' });
  assert.doesNotMatch((await a.inject({ url: '/gw' })).body, /upstream/);
});

test('a POST without a body reaches the route with {} instead of a TypeError', async (t) => {
  const a = await app(t, (f) => {
    f.post('/x', async (req, reply) => {
      const { name } = req.body;
      return name ? { name } : reply.status(400).send({ error: 'name required' });
    });
    f.patch('/y', async (req) => ({ keys: Object.keys(req.body) }));
  });
  const r = await a.inject({ method: 'POST', url: '/x' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'name required');
  assert.deepEqual((await a.inject({ method: 'PATCH', url: '/y' })).json(), { keys: [] });
  assert.equal((await a.inject({ method: 'POST', url: '/x', payload: { name: 'n' } })).json().name, 'n');
  // Broken JSON is the client's fault: 400, not 500.
  const bad = await a.inject({ method: 'POST', url: '/x', headers: { 'content-type': 'application/json' }, payload: '{oops' });
  assert.equal(bad.statusCode, 400);
});

test('fast scrape: a failed fetch hands the job to the agent, a failed apply does not', async (t) => {
  const saved = db.query;
  const queries = [];
  db.query = async (sql) => { queries.push(String(sql)); return { rows: [] }; };
  t.after(() => { db.query = saved; });
  const origError = console.error, origWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  t.after(() => { console.error = origError; console.warn = origWarn; });

  await settleFastScrape('w', 5, 'amazon/X', Promise.reject(new Error('timeout')), async () => { throw new Error('must not apply'); });
  assert.ok(queries.some(q => /status = 'pending'/.test(q)), 'fetch failure resets the job to pending');

  queries.length = 0;
  await settleFastScrape('w', 6, 'amazon/X', Promise.resolve({ title: 't' }), async () => { throw new Error('apply broke'); });
  assert.ok(queries.some(q => /status = 'done'/.test(q)));
  assert.ok(!queries.some(q => /status = 'pending'/.test(q)), 'an apply error must not reset a done job');
});

test('agent result: repeated answer ignored, late answer to a reaped job accepted; daily reads fb_campaigns', { skip: !hasTestDatabase }, async (t) => {
  const { pool } = await testDatabase(t, 'hardening');
  const key = 'k'.repeat(40);
  await pool.query(`UPDATE workspaces SET agent_key_hash = $1 WHERE id = 'test-ws'`, [createHash('sha256').update(key).digest('hex')]);
  const a = Fastify();
  registerHardening(a);
  const { default: jwt } = await import('@fastify/jwt');
  await a.register(jwt, { secret: 'hardening-test-secret-0123456789' });
  const { registerAuthenticate } = await import('../src/middleware/authenticate.js');
  registerAuthenticate(a);
  a.register((await import('../src/api/routes/agent.js')).agentRoutes, { prefix: '/api/agent' });
  a.register((await import('../src/api/routes/analytics.js')).analyticsRoutes, { prefix: '/api/analytics' });
  t.after(() => a.close());
  await a.ready();

  const job = async (status, result) => (await pool.query(
    `INSERT INTO agent_jobs(workspace_id,type,payload,status,result) VALUES ('test-ws','check_profile','{}'::jsonb,$1,$2::jsonb) RETURNING id`,
    [status, result ? JSON.stringify(result) : null])).rows[0].id;
  const post = (id, body) => a.inject({ method: 'POST', url: `/api/agent/jobs/${id}/result`, headers: { 'x-agent-key': key }, payload: body });
  const state = async (id) => (await pool.query('SELECT status, result FROM agent_jobs WHERE id = $1', [id])).rows[0];

  const open = await job('taken');
  assert.equal((await post(open, { ok: true, data: { n: 1 } })).json().ignored, undefined);
  assert.equal((await post(open, { ok: false, error: 'late duplicate' })).json().ignored, true);
  assert.equal((await state(open)).status, 'done');

  const reaped = await job('failed', { ok: false, reaped: true, error: 'x', data: null });
  assert.equal((await post(reaped, { ok: true, data: {} })).json().ignored, undefined);
  assert.equal((await state(reaped)).status, 'done');

  const cancelled = await job('failed', { ok: false, error: 'cancelled', data: null });
  assert.equal((await post(cancelled, { ok: true, data: {} })).json().ignored, true);
  assert.equal((await state(cancelled)).status, 'failed');
  assert.equal((await post(999999, { ok: true })).statusCode, 404);

  await pool.query(`INSERT INTO ap_profiles(id,workspace_id,group_name) VALUES ('ap1','test-ws','owner@test.invalid');
    INSERT INTO fb_accounts(id,workspace_id,ap_profile_id) VALUES ('fa1','test-ws','ap1');
    INSERT INTO fb_campaigns(id,workspace_id,fb_account_id,currency,spend_today,spend_yesterday) VALUES ('c1','test-ws','fa1','usd',10,25.5);`);
  const token = a.jwt.sign({ id: 'owner' });
  const daily = await a.inject({ url: '/api/analytics/daily?days=30', headers: { authorization: `Bearer ${token}` } });
  assert.equal(daily.statusCode, 200, daily.body);
  const rows = daily.json();
  assert.deepEqual(rows.map(r => [r.currency, r.spend, r.revenue]), [['USD', 25.5, null], ['USD', 10, null]]);
});
