import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { db } from '../src/db/client.js';
import { registerAuthenticate } from '../src/middleware/authenticate.js';

// authenticate.js with the user row faked: a token is valid only while its "tv" claim equals users.token_version.
async function appWith(row, t) {
  const saved = db.query;
  db.query = async () => ({ rows: row ? [row] : [] });
  t.after(() => { db.query = saved; });
  const app = Fastify();
  await app.register(jwt, { secret: 'session-test-secret-0123456789' });
  registerAuthenticate(app);
  app.get('/who', { onRequest: [app.authenticate] }, async (req) => ({ id: req.user.id, role: req.user.role }));
  t.after(() => app.close());
  await app.ready();
  return app;
}
const get = (app, claims) => app.inject({ url: '/who', headers: { authorization: `Bearer ${app.jwt.sign(claims)}` } });

test('token with the current version passes, role comes from the DB', async (t) => {
  const row = { id: 'u1', workspace_id: 'w', role: 'buyer', email: 'a@b.c', token_version: 2 };
  const app = await appWith(row, t);
  const r = await get(app, { id: 'u1', role: 'owner', tv: 2 });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().role, 'buyer');
});

test('older token is refused after the version was bumped', async (t) => {
  const app = await appWith({ id: 'u1', workspace_id: 'w', role: 'buyer', email: 'a@b.c', token_version: 3 }, t);
  assert.equal((await get(app, { id: 'u1', tv: 2 })).statusCode, 401);
  assert.equal((await get(app, { id: 'u1' })).statusCode, 401);
});

test('legacy token without the claim works while the version is still 0', async (t) => {
  const app = await appWith({ id: 'u1', workspace_id: 'w', role: 'buyer', email: 'a@b.c', token_version: 0 }, t);
  assert.equal((await get(app, { id: 'u1' })).statusCode, 200);
});

test('deleted user is refused', async (t) => {
  const app = await appWith(null, t);
  assert.equal((await get(app, { id: 'gone', tv: 0 })).statusCode, 401);
});
