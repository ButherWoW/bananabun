import { db } from '../db/client.js';

// Moderation of one ad, in words: approved | review | rejected | issues, with Facebook's reason.
export function adModeration(ad) {
  const s = ad?.effective_status;
  if (s === 'DISAPPROVED') {
    const reason = Object.entries(ad.review || {}).map(([k, v]) => `${k}: ${String(v).trim()}`).join(' · ') || null;
    return { code: 'rejected', label: 'Отклонено', reason };
  }
  if (s === 'WITH_ISSUES' || s === 'PENDING_BILLING_INFO') {
    const i = ad.issues?.[0];
    const reason = s === 'PENDING_BILLING_INFO' ? 'Нужна оплата в кабинете'
      : i ? `код ${i.code ?? '—'}: ${i.summary || i.message || 'проблема'}` : null;
    return { code: 'issues', label: 'Проблема', reason };
  }
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS') return { code: 'review', label: 'На проверке', reason: null };
  return { code: 'approved', label: 'Одобрено', reason: null };
}

// Totals for an adset or a campaign: «Отклонено 6 из 15 объявлений».
export function moderationSummary(ads) {
  const m = { total: ads.length, rejected: 0, issues: 0, review: 0 };
  for (const a of ads) {
    const c = (a.moderation || adModeration(a)).code;
    if (c in m) m[c] += 1;
  }
  const bad = m.rejected + m.issues;
  m.label = !m.total ? 'Объявлений нет'
    : bad ? `Отклонено ${bad} из ${m.total} объявлений`
    : m.review ? `На проверке ${m.review} из ${m.total}` : 'Все одобрены';
  return m;
}

// Adds moderation to every ad and adset; returns the campaign totals.
function labelModeration(adsets) {
  for (const s of adsets) {
    s.ads = (Array.isArray(s.ads) ? s.ads : []).map(a => ({ ...a, moderation: adModeration(a) }));
    s.moderation = moderationSummary(s.ads);
  }
  return moderationSummary(adsets.flatMap(s => s.ads));
}

// Replaces the campaign snapshot of every FB account bound to this AdsPower profile.
export async function saveFbCampaigns(ws, userId, data) {
  const { rows: accounts } = await db.query(`
    SELECT fa.id FROM fb_accounts fa JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE fa.workspace_id = $1 AND ap.raw->>'user_id' = $2`, [ws, String(userId)]);
  const accountId = accounts[0]?.id;
  if (!accountId) return 0;

  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const ids = campaigns.map(c => String(c.id)).filter(id => /^\d+$/.test(id));
  // Prune only inside ad accounts the agent read without error: a failed read must not wipe the list.
  const readActs = Array.isArray(data?.read_acts) ? data.read_acts.map(String) : [];
  await db.query(`DELETE FROM fb_campaigns WHERE fb_account_id = $1 AND act_id = ANY($2) AND NOT (id = ANY($3))`,
    [accountId, readActs, ids]);
  for (const c of campaigns) {
    if (!/^\d+$/.test(String(c.id))) continue;
    const adsets = Array.isArray(c.adsets) ? c.adsets : [];
    // An older agent sends adsets without ads: keep moderation unknown rather than «all approved».
    const moderation = adsets.some(s => Array.isArray(s.ads)) ? labelModeration(adsets) : null;
    await db.query(`
      INSERT INTO fb_campaigns (id, workspace_id, fb_account_id, act_id, act_name, currency, name, status, effective_status,
                                daily_budget, spend_today, spend_yesterday, spend_7d, adsets, created_time, moderation, account_status, spend_cap, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17,$18,NOW())
      ON CONFLICT (id) DO UPDATE SET fb_account_id=$3, act_id=$4, act_name=$5, currency=$6, name=$7, status=$8,
        effective_status=$9, daily_budget=$10, spend_today=$11, spend_yesterday=$12, spend_7d=$13, adsets=$14::jsonb,
        created_time=$15, moderation=$16::jsonb, account_status=$17, spend_cap=$18, synced_at=NOW()
      WHERE fb_campaigns.workspace_id = $2`,
      [String(c.id), ws, accountId, c.act, c.act_name, c.currency, c.name, c.status, c.effective_status,
       c.daily_budget, Number(c.spend_today) || 0, Number(c.spend_yesterday) || 0, Number(c.spend_7d) || 0,
       JSON.stringify(adsets), c.created_time || null, moderation ? JSON.stringify(moderation) : null,
       c.account_status != null ? Number(c.account_status) : null, Number(c.spend_cap) > 0 ? Number(c.spend_cap) : null]);
  }
  // Cabinet limits for the «where to push» hint.
  for (const a of Array.isArray(data?.accounts_info) ? data.accounts_info : []) {
    const ext = String(a.id || '').replace(/^act_/, '');
    if (!/^\d+$/.test(ext)) continue;
    await db.query(`UPDATE fb_cabinets SET currency=$1, daily_limit=$2, account_status=$3, limits_at=NOW()
                     WHERE workspace_id=$4 AND REPLACE(external_id, 'act_', '') = $5`,
      [a.currency || null, Number(a.daily_limit) > 0 ? Number(a.daily_limit) : null,
       a.account_status != null ? Number(a.account_status) : null, ws, ext]);
  }
  return campaigns.length;
}

// Mirrors edits the agent confirmed, so the list is right before the next refresh.
// An edit may hit the campaign, one of its adsets or one ad; copies show up on the next refresh.
export async function applyFbEdits(ws, done) {
  for (const d of done || []) {
    if (d.copied !== undefined) continue;
    const id = String(d.id);
    const { rows: [c] } = await db.query(`
      SELECT id, adsets FROM fb_campaigns
       WHERE workspace_id = $1 AND (id = $2 OR adsets @> $3::jsonb OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(adsets) s WHERE s->'ads' @> $3::jsonb))
       LIMIT 1`, [ws, id, JSON.stringify([{ id }])]);
    if (!c) continue;
    if (c.id === id) {
      await db.query(`UPDATE fb_campaigns SET status=COALESCE($1,status), effective_status=COALESCE($1,effective_status),
                        daily_budget=COALESCE($2,daily_budget), name=COALESCE($3,name),
                        spend_cap=CASE WHEN $4::text IS NULL THEN spend_cap WHEN $4 = '922337203685478' THEN NULL ELSE $4::bigint END
                       WHERE id=$5 AND workspace_id=$6`,
        [d.status || null, d.daily_budget ? Number(d.daily_budget) : null, d.name || null,
         d.spend_cap != null ? String(d.spend_cap) : null, id, ws]);
      continue;
    }
    const patch = (o) => ({
      ...o,
      ...(d.status ? { status: d.status, effective_status: d.status } : {}),
      ...(d.daily_budget ? { daily_budget: Number(d.daily_budget) } : {}),
      ...(d.bid_amount ? { bid_amount: Number(d.bid_amount) } : {}),
      ...(d.name ? { name: d.name } : {}),
      ...(d.targeting ? { audience: { ...(o.audience || {}), ...d.targeting } } : {}),
    });
    const adsets = (c.adsets || []).map(s => s.id === id ? patch(s)
      : { ...s, ads: (s.ads || []).map(a => (a.id === id ? patch(a) : a)) });
    await db.query(`UPDATE fb_campaigns SET adsets=$1::jsonb WHERE id=$2 AND workspace_id=$3`, [JSON.stringify(adsets), c.id, ws]);
  }
}

// Campaign history: one line per edit, closed with the agent's result.
export async function logFbEvent(ws, campaignId, userId, text, jobId = null) {
  await db.query(`INSERT INTO fb_campaign_events (workspace_id, campaign_id, user_id, text, job_id, result) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ws, String(campaignId), userId || null, text, jobId, jobId ? 'queued' : null]);
}

export async function closeFbEvents(ws, jobId, ok, error) {
  await db.query(`UPDATE fb_campaign_events SET result=$1, error=$2 WHERE workspace_id=$3 AND job_id=$4`,
    [ok ? 'done' : 'failed', ok ? null : String(error || '').slice(0, 500), ws, jobId]);
}
