import { db } from '../db/client.js';

export function adminOnly(app) {
  return {
    onRequest: [
      app.authenticate,
      async (req, reply) => {
        if (req.user.role !== 'owner' && req.user.role !== 'lead') {
          return reply.status(403).send({ error: 'Недостаточно прав' });
        }
      },
    ],
  };
}

function forbidden() {
  return Object.assign(new Error('Нет доступа'), { statusCode: 403 });
}

// Buyers may only act on rows they created; owner/lead act on the whole workspace.
async function assertOwned(req, table, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) throw Object.assign(new Error('ids required'), { statusCode: 400 });
  const { rows } = await db.query(
    `SELECT id, created_by FROM ${table} WHERE workspace_id = $1 AND id = ANY($2)`,
    [req.user.ws, list]
  );
  if (req.user.role === 'buyer') {
    if (rows.length !== list.length || rows.some(r => r.created_by !== req.user.id)) throw forbidden();
  } else if (table === 'products' && rows.length !== list.length) {
    throw Object.assign(new Error('Not found'), { statusCode: 404 });
  }
}

// Campaign actions take Facebook campaign ids. An id is allowed only if this workspace knows it:
// from our FB snapshot (buyers: their own AdsPower group), a push, or our campaigns table.
export async function assertCampaignAccess(req, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
  if (!list.length) throw Object.assign(new Error('ids required'), { statusCode: 400 });
  const buyer = req.user.role === 'buyer';
  const email = String(req.user.email || '').toLowerCase();
  const { rows } = await db.query(`
    SELECT c.id FROM fb_campaigns c
      JOIN fb_accounts fa ON fa.id = c.fb_account_id LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE c.workspace_id = $1 AND c.id = ANY($2) AND (NOT $3 OR LOWER(ap.group_name) = $4)
    UNION
    SELECT fb_campaign_id FROM pushes
     WHERE workspace_id = $1 AND fb_campaign_id = ANY($2) AND (NOT $3 OR created_by = $5)
    UNION
    SELECT id FROM campaigns
     WHERE workspace_id = $1 AND (id = ANY($2) OR fb_campaign_id = ANY($2)) AND (NOT $3 OR created_by = $5)`,
    [req.user.ws, list, buyer, email, req.user.id]);
  const known = new Set(rows.map(r => String(r.id)));
  if (list.some(id => !known.has(id))) {
    throw Object.assign(new Error('Кампания не найдена в вашей команде — обновите список из FB'), { statusCode: buyer ? 403 : 404 });
  }
}
export const assertProductAccess = (req, ids) => assertOwned(req, 'products', ids);
