import { db } from '../../db/client.js';
import { enqueueAgentJob } from './agent.js';

// AdsPower runs on the buyer's Mac, not on this server: profiles come from the agent's
// last sync, and every live action (check, open, close) is a job the agent picks up.
export async function adspowerRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  async function visibleProfiles(user, groupId) {
    const vals = [user.ws];
    let where = 'workspace_id = $1';
    if (groupId) { vals.push(String(groupId)); where += ` AND group_id = $${vals.length}`; }
    // Owner sees all profiles; others only their group (named after their email).
    if (user.role !== 'owner' && user.email) { vals.push(user.email.toLowerCase()); where += ` AND LOWER(group_name) = $${vals.length}`; }
    const { rows } = await db.query(
      `SELECT raw->>'user_id' AS user_id, serial_number, name, group_id, group_name, ip_country, last_synced_at
         FROM ap_profiles WHERE ${where} ORDER BY LENGTH(serial_number), serial_number`,
      vals
    );
    return rows;
  }

  app.get('/profiles', auth, async (req) => {
    const list = await visibleProfiles(req.user, req.query.group_id);
    return { list, page_size: list.length };
  });

  app.get('/groups', auth, async (req) => {
    const list = await visibleProfiles(req.user);
    const groups = new Map(list.filter(p => p.group_id).map(p => [p.group_id, p.group_name]));
    return { list: [...groups].map(([group_id, group_name]) => ({ group_id, group_name })) };
  });

  async function profileJob(req, reply, type) {
    const userId = String(req.body?.user_id || '');
    const own = (await visibleProfiles(req.user)).some(p => p.user_id === userId);
    if (!own) return reply.status(404).send({ error: 'Профиль не найден' });
    return { ok: true, queued: true, job_id: await enqueueAgentJob(req.user.ws, type, { user_id: userId }, req.user.id) };
  }

  app.post('/browser/open', auth, (req, reply) => profileJob(req, reply, 'open'));
  app.post('/browser/close', auth, (req, reply) => profileJob(req, reply, 'close'));

  // Connection check: the agent re-reads AdsPower and reports how many profiles it sees.
  app.post('/test', auth, async (req) => {
    return { ok: true, queued: true, job_id: await enqueueAgentJob(req.user.ws, 'sync', {}, req.user.id) };
  });
}
