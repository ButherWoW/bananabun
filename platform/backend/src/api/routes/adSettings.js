import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { ownUser, assertRecordAccess, assertProductAccess } from '../../middleware/access.js';

export async function adSettingsRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/stats', auth, async (req) => {
    const { rows } = await db.query(
      `SELECT params->>'preset_id' as preset_id, COUNT(*) as uses
       FROM pushes
       WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2) AND params->>'preset_id' IS NOT NULL
       GROUP BY params->>'preset_id'`,
      [req.user.ws, ownUser(req)]
    );
    const map = {};
    for (const r of rows) map[r.preset_id] = Number(r.uses);
    return map;
  });

  app.get('/', auth, async (req) => {
    const { rows } = await db.query(
      'SELECT * FROM ad_settings WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2) ORDER BY created_at DESC',
      [req.user.ws, ownUser(req)]
    );
    return rows;
  });

  const allowed = ['name','age_min','age_max','genders','devices','adsets_count','budget',
    'bid_strategy','bid_amount','objective','pixel_event','call_to_action',
    'auto_placement','platforms','bid_amounts','url_params','creo_mode','creo_per_adset','all_creatives','product_ids','form'];

  const PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'];

  // bid_amounts is JSONB (a bare array would be sent as a Postgres array); platforms is TEXT[].
  function pick(body) {
    const data = {};
    // An empty form field means «not set» — NULL, not '' (numeric columns reject '').
    for (const k of allowed) if (body?.[k] !== undefined) data[k] = body[k] === '' ? null : body[k];
    if (data.bid_amounts !== undefined) {
      const bids = Array.isArray(data.bid_amounts) ? data.bid_amounts.map(Number) : [];
      if (bids.some(b => !(b > 0))) throw Object.assign(new Error('Ставки по адсетам должны быть больше нуля'), { statusCode: 400 });
      data.bid_amounts = bids.length ? JSON.stringify(bids) : null;
    }
    if (data.platforms !== undefined) {
      data.platforms = (Array.isArray(data.platforms) ? data.platforms : []).filter(p => PLATFORMS.includes(p));
    }
    return data;
  }

  app.post('/', auth, async (req) => {
    const { ws, id: userId } = req.user;
    if (req.body?.product_ids?.length) await assertProductAccess(req, req.body.product_ids);
    return db.insert('ad_settings', { id: `ads_${nanoid(20)}`, workspace_id: ws, created_by: userId, ...pick(req.body) });
  });

  app.patch('/:id', auth, async (req, reply) => {
    const row = await db.findOne('ad_settings', { id: req.params.id, workspace_id: req.user.ws });
    if (!row) return reply.status(404).send({ error: 'Not found' });
    await assertRecordAccess(req, 'ad_settings', row.id);
    if (req.body?.product_ids?.length) await assertProductAccess(req, req.body.product_ids);
    const data = pick(req.body);
    if (!Object.keys(data).length) return reply.status(400).send({ error: 'Нет полей для обновления' });
    return db.update('ad_settings', row.id, data);
  });

  app.delete('/:id', auth, async (req) => {
    await assertRecordAccess(req, 'ad_settings', req.params.id);
    await db.query('DELETE FROM ad_settings WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.ws]);
    return { ok: true };
  });
}
