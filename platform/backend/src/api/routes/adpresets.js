import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';

export async function adPresetRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/', auth, async (req) => {
    const { rows } = await db.query(
      `SELECT * FROM ad_presets WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [req.user.ws]
    );
    return rows;
  });

  app.post('/', auth, async (req) => {
    const {
      name, objective, daily_budget, bid_strategy, bid_amount,
      optimization_goal, billing_event,
      fb_cabinet_id, fb_page_id, fb_pixel_id, pixel_event,
      countries, age_min, age_max
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO ad_presets (
        id, workspace_id, name, objective, daily_budget, bid_strategy, bid_amount,
        optimization_goal, billing_event, fb_cabinet_id, fb_page_id, fb_pixel_id,
        pixel_event, countries, age_min, age_max, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        `ap_${nanoid(20)}`, req.user.ws, name,
        objective || 'OUTCOME_SALES',
        daily_budget || 10,
        bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
        bid_amount || null,
        optimization_goal || 'OFFSITE_CONVERSIONS',
        billing_event || 'IMPRESSIONS',
        fb_cabinet_id || null,
        fb_page_id || null,
        fb_pixel_id || null,
        pixel_event || 'Purchase',
        JSON.stringify(countries || []),
        age_min || 18,
        age_max || 65,
        req.user.id,
      ]
    );
    return rows[0];
  });

  app.patch('/:id', auth, async (req, reply) => {
    const { rows: existing } = await db.query(
      `SELECT id FROM ad_presets WHERE id = $1 AND workspace_id = $2`,
      [req.params.id, req.user.ws]
    );
    if (!existing.length) return reply.status(404).send({ error: 'Not found' });

    const allowed = ['name', 'objective', 'daily_budget', 'bid_strategy', 'bid_amount',
      'optimization_goal', 'billing_event', 'fb_cabinet_id', 'fb_page_id', 'fb_pixel_id',
      'pixel_event', 'countries', 'age_min', 'age_max'];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        vals.push(key === 'countries' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!sets.length) return reply.status(400).send({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE ad_presets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    return rows[0];
  });

  app.delete('/:id', auth, async (req, reply) => {
    const { rows } = await db.query(
      `DELETE FROM ad_presets WHERE id = $1 AND workspace_id = $2 RETURNING id`,
      [req.params.id, req.user.ws]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });
}
