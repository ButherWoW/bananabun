import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { assertFolderAccess } from '../../middleware/access.js';

export async function folderRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // Product counts follow the same visibility as the product list: buyers count only their own.
  async function productCounts(req) {
    const isBuyer = req.user.role === 'buyer';
    const { rows } = await db.query(
      `SELECT folder_id, COUNT(*)::int AS count FROM products
       WHERE workspace_id = $1 ${isBuyer ? 'AND created_by = $2' : ''}
       GROUP BY folder_id`,
      isBuyer ? [req.user.ws, req.user.id] : [req.user.ws]
    );
    return rows;
  }

  // Personal folders are visible to their author (owner/lead see all); shared — to everyone.
  app.get('/', auth, async (req) => {
    const { ws, id: userId, role } = req.user;
    const folders = await db.findMany('folders', { workspace_id: ws }, { orderBy: 'created_at ASC' });
    const countMap = Object.fromEntries((await productCounts(req)).map(r => [r.folder_id, r.count]));
    return folders
      .filter(f => f.shared || role !== 'buyer' || f.created_by === userId)
      .map(f => ({ ...f, product_count: countMap[f.id] || 0 }));
  });

  app.get('/counts', auth, async (req) => {
    const rows = await productCounts(req);
    return {
      total: rows.reduce((s, r) => s + r.count, 0),
      unfiled: rows.find(r => r.folder_id === null)?.count || 0,
    };
  });

  // Create folder
  app.post('/', auth, async (req) => {
    const { name, parent_id, shared } = req.body;
    const { ws, id: userId } = req.user;

    await assertFolderAccess(req, parent_id);
    return db.insert('folders', {
      id: `pf_${nanoid(20)}`,
      workspace_id: ws,
      name,
      parent_id: parent_id || null,
      shared: shared || false,
      created_by: userId,
    });
  });

  // Rename folder
  app.patch('/:id', auth, async (req, reply) => {
    const folder = await db.findOne('folders', { id: req.params.id, workspace_id: req.user.ws });
    if (!folder) return reply.status(404).send({ error: 'Not found' });
    // Buyers manage only folders they created; shared folders belong to the team.
    if (req.user.role === 'buyer' && folder.created_by !== req.user.id) return reply.status(403).send({ error: 'Это не ваша папка' });
    return db.update('folders', folder.id, { name: req.body.name });
  });

  // Delete folder
  app.delete('/:id', auth, async (req, reply) => {
    const folder = await db.findOne('folders', { id: req.params.id, workspace_id: req.user.ws });
    if (!folder) return reply.status(404).send({ error: 'Not found' });
    // Buyers manage only folders they created; shared folders belong to the team.
    if (req.user.role === 'buyer' && folder.created_by !== req.user.id) return reply.status(403).send({ error: 'Это не ваша папка' });
    await db.delete('folders', folder.id);
    return { ok: true };
  });
}
