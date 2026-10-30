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

export const assertProductAccess = (req, ids) => assertRecordAccess(req, 'products', ids);
