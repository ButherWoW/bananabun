import crypto from 'crypto';
import { saveAssets } from './accounts.js';
import { applyPushResult } from '../../services/push.js';
import { applyFbEdits, saveFbCampaigns, closeFbEvents } from '../../services/fb-campaigns.js';
import { db } from '../../db/client.js';
import { adminOnly } from '../../middleware/access.js';
import { upsertProfiles } from '../../services/ap-profiles.js';

const hash = (key) => crypto.createHash('sha256').update(key).digest('hex');

async function agentWorkspace(req, reply) {
  const key = req.headers['x-agent-key'];
  if (typeof key !== 'string' || key.length < 32) return reply.status(401).send({ error: 'agent key required' });
  const { rows } = await db.query('SELECT id FROM workspaces WHERE agent_key_hash = $1', [hash(key)]);
  if (!rows[0]) return reply.status(401).send({ error: 'invalid agent key' });
  req.agentWs = rows[0].id;
  await db.query('UPDATE workspaces SET agent_seen_at = NOW() WHERE id = $1', [req.agentWs]);
}

export async function enqueueAgentJob(ws, type, payload, userId) {
  const { rows } = await db.query(
    `INSERT INTO agent_jobs (workspace_id, type, payload, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [ws, type, JSON.stringify(payload || {}), userId || null]
  );
  return rows[0].id;
}

// Server-side wait for an agent job (for work that finishes in the background, e.g. scrapes).
export async function waitAgentJobDone(ws, id, timeoutMs = 240000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { rows: [job] } = await db.query('SELECT status, result FROM agent_jobs WHERE id = $1 AND workspace_id = $2', [id, ws]);
    if (job?.status === 'done') return job.result?.data;
    if (job?.status === 'failed') throw new Error(job.result?.error || 'Агент не смог выполнить задачу');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Агент на Mac не ответил: проверьте, что он запущен и AdsPower открыт');
}

export async function agentRoutes(app) {
  // Key is shown once; only its hash is stored.
  app.post('/key', adminOnly(app), async (req) => {
    const key = crypto.randomBytes(32).toString('hex');
    await db.query('UPDATE workspaces SET agent_key_hash = $1 WHERE id = $2', [hash(key), req.user.ws]);
    return { key };
  });

  app.get('/status', { onRequest: [app.authenticate] }, async (req) => {
    const { rows } = await db.query(
      'SELECT agent_key_hash IS NOT NULL AS configured, agent_seen_at FROM workspaces WHERE id = $1', [req.user.ws]);
    const seen = rows[0]?.agent_seen_at;
    return {
      configured: !!rows[0]?.configured,
      seen_at: seen,
      online: !!seen && Date.now() - new Date(seen).getTime() < 3 * 60 * 1000,
    };
  });

  app.get('/jobs/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await db.query(
      'SELECT id, type, status, result, created_at, done_at FROM agent_jobs WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user.ws]);
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    return rows[0];
  });

  const agent = { onRequest: [agentWorkspace] };

  app.post('/ingest', agent, async (req, reply) => {
    const profiles = req.body?.profiles;
    if (!Array.isArray(profiles)) return reply.status(400).send({ error: 'profiles[] required' });
    const synced = await upsertProfiles(req.agentWs, profiles);
    return { ok: true, synced };
  });

  // Background refresh from profiles that already have Ads Manager open.
  app.post('/fb-campaigns', { ...agent, bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const userId = String(req.body?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(userId)) return reply.status(400).send({ error: 'user_id required' });
    return { ok: true, saved: await saveFbCampaigns(req.agentWs, userId, req.body) };
  });

  // Hands out pending jobs; anything taken but unanswered for 5 minutes is handed out again —
  // except pushes: a long push must never run twice at once (retry re-queues it instead).
  app.get('/jobs', agent, async (req) => {
    // Reaper: jobs nobody finished within an hour fail visibly instead of hanging forever.
    const { rows: stale } = await db.query(`
      UPDATE agent_jobs SET status = 'failed', done_at = NOW(),
             result = '{"ok":false,"error":"Агент не выполнил задачу за час","data":null}'::jsonb
       WHERE workspace_id = $1 AND status IN ('pending', 'taken') AND created_at < NOW() - INTERVAL '1 hour'
      RETURNING id, type, payload`, [req.agentWs]);
    for (const j of stale) {
      if (j.type === 'fb_edit') await closeFbEvents(req.agentWs, j.id, false, 'Агент не выполнил правку за час');
      if (j.type === 'push' && j.payload?.push_id) await applyPushResult(req.agentWs, j.payload.push_id, false, 'Агент не выполнил залив за час', null);
    }

    // A 2FA code nobody picked up within a minute is useless: fail it instead of computing it late.
    await db.query(`
      UPDATE agent_jobs SET status = 'failed', done_at = NOW(),
             result = '{"ok":false,"error":"Код 2FA не успели посчитать","data":null}'::jsonb
       WHERE workspace_id = $1 AND type = 'totp' AND status IN ('pending', 'taken') AND created_at < NOW() - INTERVAL '1 minute'`, [req.agentWs]);

    // One job at a time, so nothing sits 'taken' while the agent is busy with another.
    // Pushes and FB edits are never handed out twice: a rerun could duplicate objects or undo a newer edit.
    // ?type=totp is the agent's fast lane for 2FA codes (no browser), polled apart from the main loop.
    const onlyTotp = req.query?.type === 'totp';
    const { rows } = await db.query(`
      UPDATE agent_jobs SET status = 'taken', taken_at = NOW()
      WHERE id IN (
        SELECT id FROM agent_jobs
        WHERE workspace_id = $1 AND ($2::boolean = false OR type = 'totp')
          AND (status = 'pending' OR (status = 'taken' AND type NOT IN ('push', 'fb_edit', 'totp') AND taken_at < NOW() - INTERVAL '10 minutes'))
        ORDER BY id LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload`, [req.agentWs, onlyTotp]);
    return { jobs: rows };
  });

  app.post('/jobs/:id/result', { ...agent, bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const ok = !!req.body?.ok;
    const result = { ok, error: ok ? null : String(req.body?.error || 'failed').slice(0, 500), data: req.body?.data ?? null };
    const { rows } = await db.query(
      `UPDATE agent_jobs SET status = $1, result = $2, done_at = NOW() WHERE id = $3 AND workspace_id = $4 RETURNING type, payload`,
      [ok ? 'done' : 'failed', JSON.stringify(result), req.params.id, req.agentWs]);
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    const { type, payload } = rows[0];
    if (type === 'check_profile' && payload?.account_id) {
      if (ok && Array.isArray(result.data?.bms)) await saveAssets(req.agentWs, payload.account_id, result.data.bms);
      await db.query(`UPDATE fb_accounts SET status = $1, status_label = $2, last_checked_at = NOW() WHERE id = $3 AND workspace_id = $4`,
        [ok ? 'active' : 'error', ok ? null : result.error, payload.account_id, req.agentWs]);
    }
    if (type === 'fb_campaigns' && ok) await saveFbCampaigns(req.agentWs, payload?.user_id, result.data);
    if (type === 'fb_edit') {
      await applyFbEdits(req.agentWs, result.data?.done);
      await closeFbEvents(req.agentWs, req.params.id, ok, result.error);
    }
    if (type === 'push' && payload?.push_id) await applyPushResult(req.agentWs, payload.push_id, ok, result.error, result.data);
    return { ok: true };
  });
}
