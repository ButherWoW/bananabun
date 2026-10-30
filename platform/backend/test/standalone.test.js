import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FA_AGENT_TOKEN = 'test-token';
process.env.FA_WORKSPACE_ID = 'test-workspace';
process.env.SCRAPE_ENGINE = 'fa';
process.env.CF_ACCESS_CLIENT_ID = 'test-id';
process.env.CF_ACCESS_CLIENT_SECRET = 'test-secret';
const dir = await mkdtemp(join(tmpdir(), 'bananabun-own-'));
process.env.UPLOADS_DIR = dir;
const fa = await import('../src/services/fa-client.js');
const { currentEngine } = await import('../src/services/engine.js');
const { creativePlan } = await import('../src/services/creative-plan.js');
const { creativeRoutes, startGeneration } = await import('../src/api/routes/creatives.js');
const { db, pool } = await import('../src/db/client.js');
const { chromium } = await import('playwright');
const routes = new Map();
const app = { authenticate() {} };
for (const method of ['get', 'post', 'patch', 'delete']) app[method] = (url, auth, handler) => routes.set(`${method} ${url}`, handler);
await creativeRoutes(app);
const user = { ws: 'test-ws', id: 'owner', role: 'owner' };
const product = { id: 'test-product', workspace_id: user.ws, title: 'Own product', engine: 'fa', external_id: 'old-import', images: [] };
let browser;
let calls = 0;
const savedFetch = globalThis.fetch;
const saved = { insert: db.insert, update: db.update, findOne: db.findOne, query: db.query, launch: chromium.launch };
const rows = new Map();
let html = [];
test.after(async () => {
  globalThis.fetch = savedFetch;
  Object.assign(db, saved);
  chromium.launch = saved.launch;
  if (browser) await browser.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
globalThis.fetch = async () => { calls++; throw new Error('Unexpected external request'); };

test('old FA configuration cannot enable external requests or paid actions', async () => {
  assert.equal(currentEngine(), 'own');
  assert.equal(fa.faAvailable(), false);
  assert.equal(fa.faImagesAvailable(), false);
  for (const [name, fn] of Object.entries(fa)) {
    if (name === 'faAvailable' || name === 'faImagesAvailable') continue;
    await assert.rejects(fn({}), { code: 'FA_DISABLED', statusCode: 410 });
  }
  assert.equal(calls, 0);
});
test('quantity 8 creates eight plans; boundaries and unsupported input are rejected', () => {
  assert.equal(creativePlan({ count: 8 }).styles.length, 8);
  assert.equal(creativePlan({ count: 10 }).styles.length, 10);
  for (const count of [0, -1, 11, 1.5, 'bad']) assert.throws(() => creativePlan({ count }), { statusCode: 400 });
  assert.throws(() => creativePlan({ source: 'fa' }), { code: 'FA_DISABLED' });
  assert.throws(() => creativePlan({ styles: [] }), { statusCode: 400 });
  assert.throws(() => creativePlan({ styles: ['unknown'] }), { statusCode: 400 });
  assert.equal(creativePlan({ format: '3:2' }).format, '3x2');
});
test('source metadata tells the truth and FA imports are gone', async () => {
  const source = await routes.get('get /source')();
  assert.equal(source.active, 'local');
  assert.equal(source.generative_ai, false);
  for (const key of ['get /ready-images', 'post /import-ready/:genId', 'get /fa-ready']) {
    assert.equal(routes.get(key), undefined, key);
  }
});

test('historic FA product queues eight persistent local requests and can retry locally', async () => {
  db.insert = async (table, row) => { rows.set(row.id, row); return row; };
  db.update = async (table, id, data) => { Object.assign(rows.get(id), data); return rows.get(id); };
  db.findOne = async (table, where) => table === 'products' ? product : rows.get(where.id);
  db.query = async (sql,params) => {
    if (sql.includes('jsonb_to_recordset')) {
      const planned=JSON.parse(params[0]);
      for (const row of planned) rows.set(row.id,row);
      return { rows:planned };
    }
    if (sql.includes("SET status='pending'")) {
      Object.assign(rows.get(params[1]),{status:'pending',metadata:JSON.parse(params[0]),render_attempts:0});
      return {rows:[],rowCount:1};
    }
    return { rows:[{id:product.id,created_by:user.id}] };
  };
  const result = await startGeneration({ ws: user.ws, userId: user.id, product, body: { count: 8, format: '3x2', landing_price: 19, features: ['Useful feature'] } });
  assert.equal(result.total, 8);
  assert.equal(result.source, 'local');
  assert.ok([...rows.values()].every(row=>row.status==='pending'));
  const row = [...rows.values()][0];
  assert.equal(row.metadata.options.landing_price, 19);
  row.status = 'failed';
  const answer = await routes.get('post /:id/retry')({ params: { id: row.id }, user }, {});
  assert.equal(answer.ok, true);
  assert.equal(row.status,'pending');
  assert.equal(row.metadata.source, 'local');
  assert.equal(calls, 0);
});
test('buyer cannot retry a creative belonging to another user', async () => {
  const row = [...rows.values()][0]; row.status = 'failed';
  let status;
  await routes.get('post /:id/retry')({ params: { id: row.id }, user: { ...user, id: 'other-buyer', role: 'buyer' } }, { status(n) { status = n; return this; }, send(data) { return data; } });
  assert.equal(status, 403);
  assert.equal(row.status, 'failed');
});

test('own push trace returns stored steps and checks buyer access', async () => {
  const { pushRoutes } = await import('../src/api/routes/push.js');
  const pushHandlers = new Map();
  const pushApp = { authenticate() {} };
  for (const method of ['get', 'post', 'patch', 'delete']) pushApp[method] = (url, auth, handler) => pushHandlers.set(`${method} ${url}`, handler);
  await pushRoutes(pushApp);
  db.findOne = async () => ({ id: 'push-test', created_by: user.id, status: 'done', log: '[{"step":"keitaro_ready"}]' });
  const handler = pushHandlers.get('get /:id/trace');
  const result = await handler({ params: { id: 'push-test' }, user }, {});
  assert.deepEqual(result.steps,[{ step:'keitaro_ready' }]);
  assert.equal(result.source,'own');
  let status;
  await handler({ params: { id: 'push-test' }, user: { ...user, id:'other', role:'buyer' } },{ status(n) { status=n; return this; }, send(data) { return data; } });
  assert.equal(status,403);
});
