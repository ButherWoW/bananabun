import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

test('push sweep: restarts pending, fails dead running, attaches queued job', { skip: !hasTestDatabase }, async t => {
  const { db, pool } = await testDatabase(t, 'push_recovery');
  // push.js opens the pool on import: load it only after testDatabase() has set DATABASE_URL.
  const { recoverPushes } = await import('../src/services/push.js');
  const ins = (id, status, ago) => pool.query(
    `INSERT INTO pushes(id,workspace_id,status,params,log,created_by,created_at,updated_at,started_at)
     VALUES ($1,'test-ws',$2,'{}'::jsonb,'[]'::jsonb,'owner',NOW() - $3::interval,NOW() - $3::interval,NOW() - $3::interval)`, [id, status, ago]);
  await ins('p-fresh', 'pending', '5 seconds');
  await ins('p-old', 'pending', '10 minutes');
  await ins('p-dead', 'running', '30 minutes');
  await ins('p-young', 'running', '1 minute');
  await ins('p-queued', 'running', '30 minutes');
  const { rows: [job] } = await pool.query(
    `INSERT INTO agent_jobs(workspace_id,type,payload) VALUES ('test-ws','push','{"push_id":"p-queued"}'::jsonb) RETURNING id`);
  await recoverPushes();
  const st = async id => (await db.findOne('pushes', { id }));
  assert.equal((await st('p-fresh')).status, 'pending');
  assert.equal((await st('p-old')).status, 'failed'); // restarted; empty params fail validation visibly
  assert.match((await st('p-old')).error, /Не хватает/);
  const dead = await st('p-dead');
  assert.equal(dead.status, 'failed');
  assert.match(dead.error, /перезапуск/);
  assert.equal((await st('p-young')).status, 'running');
  const queued = await st('p-queued');
  assert.equal(queued.status, 'running');
  assert.equal(String(queued.agent_job_id), String(job.id));
});
