import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';
import { trackerScript } from '../src/services/lp-tracker.js';

test('the tracker never reads form field values and parses as a script', () => {
  const js = trackerScript({ templateId: 't1', productId: 'p', geo: 'FR' }).replace(/^<script>/, '').replace(/<\/script>$/, '');
  assert.doesNotThrow(() => new Function(js));
  assert.doesNotMatch(js, /\.value\b/);
  assert.match(js, /'rage'/);
  assert.match(js, /'dead'/);
});

test('landing behaviour report on PostgreSQL', { skip: !hasTestDatabase }, async t => {
  const { db, pool } = await testDatabase(t, 'landing_behavior');
  await pool.query(`
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES
      ('a','test-ws','a@test.invalid','A','x','buyer'),('b','test-ws','b@test.invalid','B','x','buyer');
    INSERT INTO pushes(id,workspace_id,created_by,fb_campaign_id,status) VALUES
      ('pa','test-ws','a','111','done'),('pb','test-ws','b','222','done');
    INSERT INTO landing_templates(id,workspace_id,created_by,name,html) VALUES ('lt1','test-ws','a','Landing A','<p>');`);

  const { trackRoutes } = await import('../src/api/routes/track.js');
  const { analyticsRoutes } = await import('../src/api/routes/analytics.js');
  const app = Fastify();
  const users = Object.fromEntries((await db.query('SELECT id,workspace_id AS ws,role,email FROM users')).rows.map(u => [u.id, u]));
  app.decorate('authenticate', async (req, reply) => {
    req.user = users[req.headers['x-test-user']];
    if (!req.user) return reply.code(401).send({ error: 'login' });
  });
  app.register(trackRoutes, { prefix: '/api/t' });
  app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.ready();
  t.after(() => app.close());

  const send = (v, c, ev) => app.inject({ method: 'POST', url: '/api/t', headers: { 'content-type': 'text/plain' },
    payload: JSON.stringify({ m: { v, c, t: 'lt1', p: 'p', g: 'FR', w: 400 }, ev }) });
  // Buyer A's campaign: three visitors.
  await send('v1', '111', [{ e: 'view' }, { e: 'depth', n: 25 }, { e: 'depth', n: 50 },
    { e: 'rage', b: 'price', n: 4, el: 'div.price-box' }, { e: 'dead', b: 'gallery', el: 'img.main\u0007' },
    { e: 'quiz_answer', n: 1 }, { e: 'quiz_answer', n: 2 }, { e: 'quiz_answer', n: 3 }, { e: 'leave', b: 'price', n: 40 }]);
  await send('v2', '111', [{ e: 'view' }, { e: 'depth', n: 25 }, { e: 'dead', b: 'gallery', el: 'img.main' },
    { e: 'quiz_answer', n: 1 }, { e: 'leave', b: 'gallery', n: 8 }]);
  await send('v3', '111', [{ e: 'view' }, { e: 'depth', n: 100 }, { e: 'buy_click', b: 'offer' }, { e: 'click', b: 'offer', el: 'ignored' }]);
  // Buyer B's campaign must never reach A's report.
  await send('v9', '222', [{ e: 'view' }, { e: 'rage', b: 'secret', n: 5, el: 'button#b-only' }, { e: 'leave', b: 'secret', n: 3 }]);

  const stored = (await db.query(`SELECT event, el FROM lp_events WHERE el IS NOT NULL ORDER BY id`)).rows;
  assert.ok(stored.every(r => r.event === 'rage' || r.event === 'dead'), 'element label only for rage/dead');
  assert.ok(stored.every(r => !/[\u0000-\u001f]/.test(r.el)), 'control characters are stripped');

  const report = async (user, query = '') => {
    const r = await app.inject({ method: 'GET', url: `/api/analytics/landing-behavior?from=2000-01-01&to=2100-01-01${query}`, headers: { 'x-test-user': user } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };

  await t.test('aggregates rage, dead, exits, depth and the quiz funnel', async () => {
    const r = await report('a');
    assert.equal(r.base.visitors, 3);
    assert.deepEqual(r.by.rage.map(x => x.value), ['div.price-box · price']);
    assert.equal(r.by.dead[0].value, 'img.main · gallery');
    assert.equal(r.by.dead[0].visitors, 2);
    const leftAt = Object.fromEntries(r.by.exit_depth.map(x => [x.mark, x.visitors]));
    assert.deepEqual([leftAt[25], leftAt[50], leftAt[100]], [1, 1, 0]);
    assert.deepEqual(r.quiz.steps.map(s => s.visitors), [2, 1, 1]);
    assert.equal(r.quiz.steps[1].drop, 50);
    const price = r.blocks.find(b => b.id === 'price');
    assert.equal(price.rage_clicks, 1);
    assert.deepEqual(r.options.templates.map(x => x.name), ['Landing A']);
    assert.deepEqual(r.options.campaigns.map(x => x.id), ['111']);
  });

  await t.test('a buyer never sees another buyer\'s campaigns; the owner sees both', async () => {
    const a = await report('a');
    assert.ok(!JSON.stringify(a).includes('b-only'));
    assert.equal((await report('a', '&campaign=222')).base.visitors, 0);
    const owner = await report('owner');
    assert.equal(owner.base.visitors, 4);
    assert.ok(owner.by.rage.some(x => x.value.startsWith('button#b-only')));
  });

  await t.test('filters by landing template', async () => {
    assert.equal((await report('a', '&template=lt1')).base.visitors, 3);
    assert.equal((await report('a', '&template=other')).base.visitors, 0);
  });
});
