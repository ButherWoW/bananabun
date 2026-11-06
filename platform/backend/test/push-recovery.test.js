import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignIdempotent, isAliasTaken, lastLoggedAlias } from '../src/services/push.js';
import { hasTestDatabase, testDatabase } from './helpers/test-db.js';

const aliasErr = () => new Error('Keitaro 422: {"alias":["Alias is already used"]}');

test('isAliasTaken recognises only alias collisions', () => {
  assert.equal(isAliasTaken(aliasErr()), true);
  assert.equal(isAliasTaken(new Error('Keitaro 500: alias')), false);
  assert.equal(isAliasTaken(new Error('Keitaro 422: domain_id invalid')), false);
});

test('lastLoggedAlias takes the newest keitaro_creating entry', () => {
  assert.equal(lastLoggedAlias(null), null);
  assert.equal(lastLoggedAlias([{ step: 'keitaro_creating', alias: 'a' }, { step: 'x' }, { step: 'keitaro_creating', alias: 'b' }]), 'b');
});

test('alias collision is retried with a new alias', async () => {
  const seen = [];
  const kt = { createCampaign: async (d) => { seen.push(d.alias); if (seen.length < 3) throw aliasErr(); return { id: 7, alias: d.alias }; } };
  const logged = [];
  const r = await createCampaignIdempotent(kt, { name: 'n' }, 'Good Product', null, async a => { logged.push(a); });
  assert.equal(r.campaign.id, 7);
  assert.equal(new Set(seen).size, 3);
  assert.deepEqual(logged, seen);
});

test('other Keitaro errors and exhausted attempts are thrown', async () => {
  const bad = { createCampaign: async () => { throw new Error('Keitaro 500: boom'); } };
  await assert.rejects(createCampaignIdempotent(bad, {}, 'x', null), /500/);
  let n = 0;
  const always = { createCampaign: async () => { n++; throw aliasErr(); } };
  await assert.rejects(createCampaignIdempotent(always, {}, 'x', null, undefined, 3), /already used/);
  assert.equal(n, 3);
});

test('rerun adopts the campaign created by the interrupted attempt', async () => {
  const kt = {
    allCampaigns: async () => [{ id: 1, alias: 'other' }, { id: 42, alias: 'prev-alias' }],
    createCampaign: async () => { throw new Error('must not create a second campaign'); },
  };
  const r = await createCampaignIdempotent(kt, {}, 'x', 'prev-alias');
  assert.equal(r.adopted, true);
  assert.equal(r.campaign.id, 42);
});

test('rerun with a logged alias that never reached Keitaro reuses that alias', async () => {
  let used;
  const kt = { allCampaigns: async () => [], createCampaign: async (d) => { used = d.alias; return { id: 5, alias: d.alias }; } };
  await createCampaignIdempotent(kt, {}, 'x', 'prev-alias');
  assert.equal(used, 'prev-alias');
});

test('push sweep: restarts pending, fails dead running, attaches queued job', { skip: !hasTestDatabase }, async t => {
  const { db, pool } = await testDatabase(t, 'push_recovery');
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
