import { db, pool } from '../../db/client.js';
import { enqueueAgentJob } from './agent.js';

// Replaces an account's BMs, cabinets and pages atomically (manual edit or the agent's FB check).
export async function saveAssets(ws, id, bms) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fb_bms WHERE fb_account_id = $1', [id]);

    let cabinets_count = 0, pages_count = 0;
    for (const bm of bms) {
      const bmId = `fbbm_${id}_${bm.external_id}`;
      await client.query(`
        INSERT INTO fb_bms (id, workspace_id, fb_account_id, external_id, name, agency, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET name=$5, status=$7
      `, [bmId, ws, id, bm.external_id, bm.name, bm.agency || '', bm.status || 'active']);

      for (const cab of bm.cabinets || []) {
        const cabId = `fbcab_${bmId}_${cab.external_id}`;
        await client.query(`
          INSERT INTO fb_cabinets (id, workspace_id, bm_id, fb_account_id, external_id, name, pixel_id, status, status_label, ready_kind, ready_label, payment_missing)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (id) DO UPDATE SET name=$6, status=$8, status_label=$9, ready_kind=$10, ready_label=$11, payment_missing=$12
        `, [cabId, ws, bmId, id, cab.external_id, cab.name, cab.pixel || null,
            cab.status || 'active', cab.status_label || null,
            cab.ready?.kind || 'unknown', cab.ready?.label || null,
            cab.payment_missing || false]);
        cabinets_count++;
      }

      for (const pg of bm.pages || []) {
        const pgId = `fbpage_${bmId}_${pg.external_id}`;
        await client.query(`
          INSERT INTO fb_pages (id, workspace_id, bm_id, fb_account_id, external_id, name, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET name=$6, status=$7
        `, [pgId, ws, bmId, id, pg.external_id, pg.name, pg.status || 'active']);
        pages_count++;
      }
    }

    await client.query(`
      UPDATE fb_accounts SET bms_count=$1, cabinets_count=$2, pages_count=$3, last_checked_at=NOW()
      WHERE id=$4
    `, [bms.length, cabinets_count, pages_count, id]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// An account of this workspace that the user may touch: buyers only their own AdsPower group.
async function findAccount(req, id) {
  const { rows: [acc] } = await db.query(`
    SELECT fa.* FROM fb_accounts fa LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE fa.id = $1 AND fa.workspace_id = $2 AND ($3::text IS NULL OR LOWER(ap.group_name) = $3)`,
    [id, req.user.ws, req.user.role === 'buyer' ? String(req.user.email || '').toLowerCase() : null]);
  return acc || null;
}

export async function accountRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // List all FB accounts with their assets
  app.get('/', auth, async (req) => {
    const { ws } = req.user;
    const { rows: accounts } = await db.query(`
      SELECT fa.*, ap.serial_number, ap.name as ap_name, ap.ip_country, ap.group_name,
             ap.raw->>'user_id' as ap_user_id, ap.last_synced_at
      FROM fb_accounts fa
      LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
      WHERE fa.workspace_id = $1
        AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)
      ORDER BY fa.created_at DESC
    `, [ws, req.user.role === 'buyer' ? String(req.user.email || '').toLowerCase() : null]);

    // Batch-load all BMs + cabinets/pages in one query to avoid N+1
    const accountIds = accounts.map(a => a.id);
    const { rows: allBms } = accountIds.length ? await db.query(`
      SELECT b.*,
        json_agg(c.*) FILTER (WHERE c.id IS NOT NULL) as cabinets,
        json_agg(p.*) FILTER (WHERE p.id IS NOT NULL) as pages
      FROM fb_bms b
      LEFT JOIN fb_cabinets c ON c.bm_id = b.id
      LEFT JOIN fb_pages p ON p.bm_id = b.id
      WHERE b.fb_account_id = ANY($1::text[])
      GROUP BY b.id
      ORDER BY b.name
    `, [accountIds]) : { rows: [] };
    const bmsByAccount = {};
    for (const bm of allBms) { (bmsByAccount[bm.fb_account_id] = bmsByAccount[bm.fb_account_id] || []).push(bm); }
    return accounts.map(acc => ({ ...acc, bms: bmsByAccount[acc.id] || [] }));
  });

  // AdsPower runs on the buyer's Mac, so the sync is a job for the local agent.
  // FB data is never fetched from the server's IP: that bypasses the profile fingerprint.
  app.post('/sync', auth, async (req) => {
    const jobId = await enqueueAgentJob(req.user.ws, 'sync', {}, req.user.id);
    return { ok: true, queued: true, job_id: jobId };
  });

  // Update FB account assets manually (BMs, cabinets, pages)
  app.put('/:id/assets', auth, async (req, reply) => {
    const acc = await findAccount(req, req.params.id);
    if (!acc) return reply.status(404).send({ error: 'Not found' });
    await saveAssets(req.user.ws, acc.id, req.body?.bms || []);
    return { ok: true };
  });

  // Open AdsPower browser for account's profile
  app.post('/:id/open', auth, async (req) => {
    const { id } = req.params;
    const { ws } = req.user;

    const acc = await findAccount(req, id);
    if (!acc) throw new Error('Account not found');

    const ap = await db.findOne('ap_profiles', { id: acc.ap_profile_id });
    if (!ap?.raw?.user_id) throw new Error('Профиль AdsPower не найден — запустите синхронизацию');

    const jobId = await enqueueAgentJob(ws, 'open', { user_id: ap.raw.user_id }, req.user.id);
    return { ok: true, queued: true, job_id: jobId };
  });

  // FB check runs on the Mac: the agent opens Ads Manager in the profile and reads
  // cabinets, pages and pixels with the session token; only those come back.
  app.post('/:id/check-profile', auth, async (req, reply) => {
    const acc = await findAccount(req, req.params.id);
    if (!acc) return reply.status(404).send({ error: 'Аккаунт не найден' });
    const ap = await db.findOne('ap_profiles', { id: acc.ap_profile_id });
    if (!ap?.raw?.user_id) return reply.status(400).send({ error: 'Профиль AdsPower не найден — запустите синхронизацию' });
    const jobId = await enqueueAgentJob(req.user.ws, 'check_profile', { user_id: ap.raw.user_id, account_id: acc.id }, req.user.id);
    return { ok: true, queued: true, job_id: jobId };
  });

  // Current 2FA code of the account's AdsPower profile. The agent computes it on the Mac from the
  // profile's 2FA key; only the 6 digits come back, and they are wiped from the job right after.
  app.post('/:id/2fa', auth, async (req, reply) => {
    const acc = await findAccount(req, req.params.id);
    if (!acc) return reply.status(404).send({ error: 'Аккаунт не найден' });
    const ap = await db.findOne('ap_profiles', { id: acc.ap_profile_id });
    if (!ap?.raw?.user_id) return reply.status(400).send({ error: 'Профиль AdsPower не найден — запустите синхронизацию' });
    const jobId = await enqueueAgentJob(req.user.ws, 'totp', { user_id: ap.raw.user_id }, req.user.id);
    req.log.info({ account: acc.id, user: req.user.id }, '2fa code requested');
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      const { rows: [job] } = await db.query('SELECT status, result FROM agent_jobs WHERE id = $1 AND workspace_id = $2', [jobId, req.user.ws]);
      if (job?.status === 'done' || job?.status === 'failed') {
        const data = job.result?.data || {};
        await db.query(`UPDATE agent_jobs SET result = jsonb_build_object('ok', $2::boolean, 'data', jsonb_build_object('source', $3::text)) WHERE id = $1`,
          [jobId, job.status === 'done', data.source || null]);
        if (job.status === 'failed') return reply.status(400).send({ error: job.result?.error || 'Не удалось получить код' });
        return { code: data.code, next_code: data.next_code, seconds_left: data.seconds_left, period: data.period, source: data.source };
      }
      await new Promise(r => setTimeout(r, 700));
    }
    // Wipe any partial result left by the agent so the code never leaks via a later read.
    await db.query(`UPDATE agent_jobs SET result = '{"ok":false,"data":{"source":"timeout"}}'::jsonb WHERE id = $1`, [jobId]);
    return reply.status(504).send({ error: 'Агент на Mac не ответил за 25 секунд — он занят другой задачей или не запущен' });
  });

  // Update account fields (status, BM, pixels) — only those present in the body
  app.patch('/:id', auth, async (req, reply) => {
    const { id } = req.params;
    const { ws } = req.user;
    if (!(await findAccount(req, id))) return reply.status(404).send({ error: 'Аккаунт не найден' });
    const body = req.body || {};
    const sets = [];
    const vals = [];
    for (const k of ['status', 'status_label', 'bm_id']) {
      if (body[k] !== undefined) { vals.push(body[k]); sets.push(`${k}=$${vals.length}`); }
    }
    if (body.pixel_ids !== undefined) {
      const ids = Array.isArray(body.pixel_ids) ? body.pixel_ids : [];
      vals.push(JSON.stringify(ids.map(String)));
      sets.push(`pixel_ids=$${vals.length}::jsonb`);
    }
    if (!sets.length) return reply.status(400).send({ error: 'Нет полей для обновления' });
    vals.push(id, ws);
    const { rows } = await db.query(
      `UPDATE fb_accounts SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${vals.length - 1} AND workspace_id=$${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Аккаунт не найден' });
    return rows[0];
  });
}
