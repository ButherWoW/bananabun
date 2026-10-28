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

const PERSONAL_TABLES = new Set(['products', 'creatives', 'bundle_presets', 'creative_presets', 'landing_templates', 'ad_settings', 'ad_presets', 'scrape_jobs']);
export const ownUser = req => req.user.role === 'buyer' ? req.user.id : null;

// Personal rows always belong to this workspace and, for buyers, this author.
export async function assertRecordAccess(req, table, ids) {
  if (!PERSONAL_TABLES.has(table)) throw new Error('Unsupported access table');
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
  if (!list.length) throw Object.assign(new Error('ids required'), { statusCode: 400 });
  const { rows } = await db.query(
    `SELECT * FROM ${table} WHERE workspace_id = $1 AND id = ANY($2)`,
    [req.user.ws, list]
  );
  if (rows.length !== list.length || (ownUser(req) && rows.some(r => r.created_by !== req.user.id))) {
    throw Object.assign(new Error('Not found or access denied'), { statusCode: ownUser(req) ? 403 : 404 });
  }
  return rows;
}

export async function assertFolderAccess(req, id) {
  if (!id) return;
  const folder = await db.findOne('folders', { id, workspace_id: req.user.ws });
  // Shared folders are team categories; products inside still follow author scope.
  if (!folder || (ownUser(req) && !folder.shared && folder.created_by !== req.user.id)) throw forbidden();
  return folder;
}

export async function assertCreativeAccess(req, ids, { productId, ready = false } = {}) {
  const rows = await assertRecordAccess(req, 'creatives', ids);
  if (productId && rows.some(r => r.product_id !== productId)) {
    throw Object.assign(new Error('Креативы должны принадлежать выбранному товару'), { statusCode: 400 });
  }
  if (ready && rows.some(r => r.status !== 'done' || !r.file_url)) {
    throw Object.assign(new Error('Часть креативов не готова'), { statusCode: 400 });
  }
  return rows;
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
export const assertProductAccess = (req, ids) => assertRecordAccess(req, 'products', ids);
