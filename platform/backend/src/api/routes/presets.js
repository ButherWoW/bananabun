import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { assertRecordAccess, ownUser } from '../../middleware/access.js';

export async function presetRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // Bundle presets
  app.get('/bundles', auth, async (req) => {
    return db.findMany('bundle_presets', { workspace_id: req.user.ws, ...(ownUser(req) ? { created_by: req.user.id } : {}) }, { orderBy: 'created_at ASC' });
  });

  app.post('/bundles', auth, async (req) => {
    const { name, currency, config } = req.body || {};
    return db.insert('bundle_presets', {
      id: `bp_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name,
      currency: currency || 'EUR',
      config: JSON.stringify(config),
      created_by: req.user.id,
    });
  });

  app.delete('/bundles/:id', auth, async (req, reply) => {
    const preset = await db.findOne('bundle_presets', { id: req.params.id, workspace_id: req.user.ws });
    if (!preset) return reply.status(404).send({ error: 'Not found' });
    await assertRecordAccess(req, 'bundle_presets', preset.id);
    await db.delete('bundle_presets', preset.id);
    return { ok: true };
  });

  // Creative presets
  app.get('/creatives', auth, async (req) => {
    return db.findMany('creative_presets', { workspace_id: req.user.ws, ...(ownUser(req) ? { created_by: req.user.id } : {}) }, { orderBy: 'created_at ASC' });
  });

  app.post('/creatives', auth, async (req) => {
    const { name, template, formats, params } = req.body || {};
    return db.insert('creative_presets', {
      id: `cp_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name,
      template: JSON.stringify(template || params || {}),
      formats: JSON.stringify(formats || ['1x1', '4x5', '9x16']),
      created_by: req.user.id,
    });
  });

  app.delete('/creatives/:id', auth, async (req, reply) => {
    const preset = await db.findOne('creative_presets', { id: req.params.id, workspace_id: req.user.ws });
    if (!preset) return reply.status(404).send({ error: 'Not found' });
    await assertRecordAccess(req, 'creative_presets', preset.id);
    await db.delete('creative_presets', preset.id);
    return { ok: true };
  });
}
