import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { gateRoutes } from '../src/api/routes/gate.js';
import { createLimiter, hasPass, makePass, parsePins } from '../src/services/gate.js';

const SECRET = 'test-only-gate-secret-0123456789abcdef';
const env = { GATE_SECRET: SECRET, GATE_PINS: '2000:bd, 0401:ul,1234:nope,12:bl' };

async function gate(t, opts = {}) {
  const app = Fastify();
  app.register(gateRoutes, { prefix: '/gate', env, ...opts });
  t.after(() => app.close());
  return app;
}
const unlock = (app, pin, ip = '1.2.3.4') => app.inject({ method: 'POST', url: '/gate/unlock', headers: { 'x-real-ip': ip }, payload: { pin } });
const check = (app, door, cookie) => app.inject({ url: `/gate/check/${door}`, headers: cookie ? { cookie } : {} });

test('pins keep leading zeros and drop unknown doors and short pins', () => {
  assert.deepEqual([...parsePins(env.GATE_PINS)], [['2000', 'bd'], ['0401', 'ul']]);
  assert.equal(parsePins('').size, 0);
});

test('a right PIN sets a pass for its own door only', async (t) => {
  const app = await gate(t);
  const res = await unlock(app, '0401');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { to: '/umbrella/login' });
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, /^gate_ul=\d+\.[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  const pass = cookie.split(';')[0];
  assert.equal((await check(app, 'ul', `a=1; ${pass}`)).statusCode, 204);
  assert.equal((await check(app, 'bl', pass.replace('gate_ul', 'gate_bl'))).statusCode, 401);
  assert.equal((await check(app, 'ul')).statusCode, 401);
  assert.equal((await check(app, 'zz', pass)).statusCode, 401);
});

test('forged, tampered and expired passes are refused', () => {
  const now = Date.now();
  const p = makePass(SECRET, 'bd', now);
  assert.ok(hasPass(SECRET, 'bd', `${p.name}=${p.value}`, now));
  assert.ok(!hasPass('another-secret-0123456789abcdefghij', 'bd', `${p.name}=${p.value}`, now));
  const [exp, sig] = p.value.split('.');
  assert.ok(!hasPass(SECRET, 'bd', `${p.name}=${Number(exp) + 1000}.${sig}`, now));
  assert.ok(!hasPass(SECRET, 'bd', `${p.name}=${p.value}`, now + 13 * 3600e3));
});

test('wrong PINs lock the IP, other IPs still get in', async (t) => {
  const app = await gate(t);
  for (let i = 0; i < 5; i++) assert.equal((await unlock(app, '9999')).statusCode, 401);
  assert.equal((await unlock(app, '2000')).statusCode, 429);
  assert.equal((await unlock(app, '2000', '5.6.7.8')).statusCode, 200);
  assert.equal((await unlock(app, 'abc', '5.6.7.8')).statusCode, 401);
});

test('too many wrong PINs from everyone close every door for a while', () => {
  const l = createLimiter({ total: 3 });
  const now = Date.now();
  ['a', 'b', 'c'].forEach((ip) => l.fail(ip, now));
  assert.ok(l.blocked('d', now + 1000));
  assert.ok(!l.blocked('d', now + 61 * 60e3));
  const one = createLimiter();
  for (let i = 0; i < 5; i++) one.fail('x', now);
  assert.ok(one.blocked('x', now + 59 * 60e3));
  assert.ok(!one.blocked('x', now + 61 * 60e3));
});

test('without a secret or pins every door stays closed', async (t) => {
  const app = await gate(t, { env: { GATE_PINS: '2000:bd' } });
  assert.equal((await unlock(app, '2000')).statusCode, 503);
  const p = makePass('', 'bd');
  assert.equal((await check(app, 'bd', `${p.name}=${p.value}`)).statusCode, 401);
});
