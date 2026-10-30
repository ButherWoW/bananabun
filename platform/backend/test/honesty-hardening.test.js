import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';
import { HEADLINES } from '../src/services/flux-generator.js';
import { attemptLimiter } from '../src/services/attempt-limit.js';

test('creative headlines carry no invented urgency', () => {
  const urgency = /limit|flash|exclusi|imbat|unbeat|unschlag|begrenz|liquida|svendita|sale\b|today|aujourd|hoy|heute|oggi|hoje|now\b|jetzt|maintenant|ahora|adesso|agora|dernier|last/i;
  for (const [lang, list] of Object.entries(HEADLINES)) {
    assert.equal(list.length, 5, lang);
    for (const h of list) assert.doesNotMatch(h, urgency, `${lang}: ${h}`);
  }
});

test('attempt limiter blocks after the limit and forgets after the window', () => {
  const l = attemptLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) { assert.equal(l.blocked('k', i), false); l.fail('k', i); }
  assert.equal(l.blocked('k', 10), true);
  assert.equal(l.blocked('k', 1500), false);
  l.fail('k', 1500); l.clear('k');
  assert.equal(l.blocked('k', 1500), false);
});

test('product edits and sign-in limits on PostgreSQL', { skip: !hasTestDatabase }, async t => {
  const { db } = await testDatabase(t, 'honesty');
  process.env.INVITE_CODE = 'invite-test';
  await db.query(`INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES ('u1','test-ws','u1@test.invalid','U1',$1,'owner')`,
    [await bcrypt.hash('right-pass', 4)]);
  await db.query(`INSERT INTO products(id,workspace_id,created_by,title,source_url,source_price,marketplace,engine,rating,reviews_count)
    VALUES ('sc','test-ws','owner','Scraped','https://www.amazon.fr/dp/B012345678',60,'fr','own',4.2,231)`);

  const { productRoutes } = await import('../src/api/routes/products.js');
  const { authRoutes, loginLimit, registerLimit } = await import('../src/api/routes/auth.js');
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req) => { req.user = { id: 'owner', ws: 'test-ws', role: 'owner', email: 'owner@test.invalid' }; });
  app.register(productRoutes, { prefix: '/api/products' });
  app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  t.after(() => app.close());
  const patch = (id, payload) => app.inject({ method: 'PATCH', url: `/api/products/${id}`, payload });

  await t.test('rating, review counts and a scraped price cannot be typed in', async () => {
    const r = await patch('sc', { rating: 5, reviews_count: 9999, photo_reviews_count: 50, source_price: 1, title: 'New title' });
    assert.equal(r.statusCode, 200, r.body);
    const row = await db.findOne('products', { id: 'sc' });
    assert.equal(Number(row.rating), 4.2);
    assert.equal(row.reviews_count, 231);
    assert.equal(Number(row.source_price), 60);
    assert.equal(row.title, 'New title');
  });

  await t.test('old price is the real price × paid units, never the typed value', async () => {
    const bundles = [{ qty: '1', price: '19.99', old_price: '199.99', currency: 'EUR' },
      { qty: '2+1', price: '29.99', old_price: '999', currency: 'EUR' },
      { qty: 'set', price: '9.99', old_price: '50', currency: 'EUR' },
      { qty: '1', price: '25', old_price: '80', currency: 'USD' }];
    const r = await patch('sc', { bundle_config: JSON.stringify(bundles) });
    assert.equal(r.statusCode, 200, r.body);
    const saved = (await db.findOne('products', { id: 'sc' })).bundle_config;
    const list = typeof saved === 'string' ? JSON.parse(saved) : saved;
    assert.deepEqual(list.map(b => b.old_price), ['60.00', '120.00', '', '']);
  });

  await t.test('without a shop price the old price stays empty', async () => {
    const r = await patch('p', { bundle_config: [{ qty: '1', price: '9', old_price: '199.99' }] });
    assert.equal(r.statusCode, 200, r.body);
    const saved = (await db.findOne('products', { id: 'p' })).bundle_config;
    assert.equal((typeof saved === 'string' ? JSON.parse(saved) : saved)[0].old_price, '');
  });

  await t.test('photos are own uploads or https only', async () => {
    for (const bad of [['http://127.0.0.1/x.jpg'], ['/uploads/../etc/passwd'], ['file:///etc/passwd'], ['javascript:alert(1)']]) {
      assert.equal((await patch('sc', { images: JSON.stringify(bad) })).statusCode, 400, bad[0]);
    }
    const good = ['/uploads/images/a-1.jpg', 'https://m.media-amazon.com/images/I/x.jpg'];
    assert.equal((await patch('sc', { images: JSON.stringify(good) })).statusCode, 200);
  });

  await t.test('ten failed sign-ins lock that address + email; the right password then still waits', async () => {
    loginLimit.reset();
    const login = (password, email = 'u1@test.invalid') => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    assert.equal((await login('right-pass')).statusCode, 200);
    for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).statusCode, 401);
    const locked = await login('right-pass');
    assert.equal(locked.statusCode, 429);
    assert.match(locked.json().error, /Слишком много/);
    assert.equal((await login('wrong', 'other@test.invalid')).statusCode, 401, 'another email is not locked');
  });

  await t.test('five wrong invite codes lock registration from that address', async () => {
    registerLimit.reset();
    const reg = (code) => app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'n@test.invalid', password: 'secret1', name: 'N', invite_code: code } });
    for (let i = 0; i < 5; i++) assert.equal((await reg('bad')).statusCode, 403);
    assert.equal((await reg('invite-test')).statusCode, 429);
  });
});
