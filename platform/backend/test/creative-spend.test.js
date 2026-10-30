import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import sharp from 'sharp';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

test('fal prices: per image, per megapixel rounded up, env override, unknown model is not measured', async () => {
  const { falOutputCost, totalCost } = await import('../src/services/fal-pricing.js');
  assert.equal(falOutputCost('fal-ai/ideogram/v2'), 0.08);
  assert.equal(falOutputCost('fal-ai/ideogram/v2/remix'), 0.08);
  assert.equal(falOutputCost('fal-ai/flux/dev', { width: 1024, height: 1024 }), 0.05);
  assert.equal(falOutputCost('fal-ai/flux/dev'), null, 'a per-megapixel price needs the size');
  assert.equal(falOutputCost('fal-ai/some/new-model'), null);
  process.env.FAL_PRICE_USD_FAL_AI_SOME_NEW_MODEL = '0.03';
  try { assert.equal(falOutputCost('fal-ai/some/new-model'), 0.03); }
  finally { delete process.env.FAL_PRICE_USD_FAL_AI_SOME_NEW_MODEL; }
  assert.equal(totalCost([{ ok: false, cost_usd: 0 }, { ok: true, cost_usd: 0.08 }]), 0.08);
  assert.equal(totalCost([{ ok: true, cost_usd: null }]), null);
});

test('AI creative spend is recorded per creative and reported per period on PostgreSQL', { skip: !hasTestDatabase }, async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'spend-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  process.env.FAL_API_KEY = 'test-key';
  process.env.UPLOADS_DIR = tmp;
  t.after(() => { delete process.env.FAL_API_KEY; delete process.env.UPLOADS_DIR; });

  const { db } = await testDatabase(t, 'creative_spend');
  await db.query(`INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES
    ('a','test-ws','a@test.invalid','A','x','buyer'), ('b','test-ws','b@test.invalid','B','x','buyer')`);
  const { runCreativeJobs } = await import('../src/services/creative-jobs.js');
  const { creativeRoutes } = await import('../src/api/routes/creatives.js');

  const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
  const savedFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = savedFetch; });
  let remixFails = false;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://fal.run/')) {
      if (remixFails && String(url).endsWith('/remix')) return { ok: false, status: 422, text: async () => 'bad image' };
      return { ok: true, json: async () => ({ images: [{ url: 'https://fal-output/r.jpg' }] }) };
    }
    return { ok: true, arrayBuffer: async () => new Uint8Array(jpg).buffer };
  };

  const queue = (id, createdBy, extra = {}) => db.insert('creatives', {
    id, workspace_id: 'test-ws', created_by: createdBy, product_id: 'p', status: 'pending', type: 'image', format: '1x1',
    metadata: { source: 'flux', style: 'clean', language: 'fr', auto_slot: 0, options: { headline: id, ...extra } },
  });
  await db.query(`UPDATE products SET images='["https://images.example/p.jpg"]'::jsonb WHERE id='p'`);

  await t.test('a remix generation stores its model and price', async () => {
    await queue('c-remix', 'a');
    await runCreativeJobs({ limit: 1 });
    const row = await db.findOne('creatives', { id: 'c-remix' });
    assert.equal(row.status, 'done', JSON.stringify(row.metadata));
    assert.equal(row.metadata.model, 'fal-ai/ideogram/v2/remix');
    assert.equal(row.metadata.cost_usd, 0.08);
    assert.equal(row.metadata.cached, false);
  });

  await t.test('a failed remix and its fallback are both recorded; only the successful output is billed', async () => {
    remixFails = true;
    await queue('c-fallback', 'b');
    await runCreativeJobs({ limit: 1 });
    remixFails = false;
    const row = await db.findOne('creatives', { id: 'c-fallback' });
    assert.equal(row.status, 'done', JSON.stringify(row.metadata));
    assert.deepEqual(row.metadata.fal_requests.map(r => [r.model, r.ok, r.cost_usd]),
      [['fal-ai/ideogram/v2/remix', false, 0], ['fal-ai/ideogram/v2', true, 0.08]]);
    assert.equal(row.metadata.model, 'fal-ai/ideogram/v2');
    assert.equal(row.metadata.cost_usd, 0.08);
  });

  await t.test('the same request again comes from the cache and costs nothing', async () => {
    const before = calls.length;
    await queue('c-cached', 'a');
    await db.query(`UPDATE creatives SET metadata = jsonb_set(metadata, '{options,headline}', '"c-remix"') WHERE id='c-cached'`);
    await runCreativeJobs({ limit: 1 });
    const row = await db.findOne('creatives', { id: 'c-cached' });
    assert.equal(row.status, 'done');
    assert.equal(row.metadata.cost_usd, 0);
    assert.equal(row.metadata.cached, true);
    assert.equal(calls.length, before, 'no request to fal.ai');
  });

  await t.test('a download failure after a billed output keeps the cost on the failed creative', async () => {
    const ok = globalThis.fetch;
    globalThis.fetch = async (url, o) => String(url).startsWith('https://fal-output/') ? { ok: false, status: 500 } : ok(url, o);
    await queue('c-lost', 'a');
    await runCreativeJobs({ limit: 1 });
    globalThis.fetch = ok;
    const row = await db.findOne('creatives', { id: 'c-lost' });
    assert.equal(row.status, 'failed');
    assert.equal(row.metadata.cost_usd, 0.08);
  });

  await t.test('spend: buyer sees only own, owner sees authors; older rows are unmeasured; bad dates refused', async () => {
    await db.insert('creatives', { id: 'c-old', workspace_id: 'test-ws', created_by: 'a', product_id: 'p', status: 'done', type: 'image', format: '1x1', metadata: { source: 'flux' } });
    await db.insert('creatives', { id: 'c-local', workspace_id: 'test-ws', created_by: 'a', product_id: 'p', status: 'done', type: 'image', format: '1x1', metadata: { source: 'local' } });
    const app = Fastify();
    let user;
    app.decorate('authenticate', async req => { req.user = user; });
    app.register(creativeRoutes, { prefix: '/creatives' });
    await app.ready();
    t.after(() => app.close());
    const spend = async (u, qs = '') => { user = u; return app.inject({ method: 'GET', url: `/creatives/spend${qs}` }); };

    const a = (await spend({ id: 'a', ws: 'test-ws', role: 'buyer' })).json();
    assert.equal(a.count, 4, JSON.stringify(a));
    assert.equal(a.total_usd, 0.16);
    assert.equal(a.count_unmeasured, 1);
    assert.equal(a.count_cached, 1);
    assert.equal(a.by_author, undefined);

    const b = (await spend({ id: 'b', ws: 'test-ws', role: 'buyer' })).json();
    assert.equal(b.count, 1);
    assert.equal(b.total_usd, 0.08);

    const owner = (await spend({ id: 'owner', ws: 'test-ws', role: 'owner' })).json();
    assert.equal(owner.total_usd, 0.24);
    assert.deepEqual(owner.by_author.map(x => [x.user_id, x.total_usd, x.count]), [['a', 0.16, 4], ['b', 0.08, 1]]);
    assert.equal(owner.by_day.length, 1);

    const past = (await spend({ id: 'owner', ws: 'test-ws', role: 'owner' }, '?from=2020-01-01&to=2020-01-31')).json();
    assert.equal(past.count, 0);
    assert.equal(past.total_usd, 0);
    assert.equal((await spend({ id: 'owner', ws: 'test-ws', role: 'owner' }, '?from=2020-02-01&to=2020-01-01')).statusCode, 400);
    assert.equal((await spend({ id: 'owner', ws: 'test-ws', role: 'owner' }, '?from=yesterday')).statusCode, 400);
  });
});
