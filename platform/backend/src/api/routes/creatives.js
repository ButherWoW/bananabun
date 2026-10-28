import { assertProductAccess, ownUser } from '../../middleware/access.js';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs/promises';
import { db } from '../../db/client.js';
import { wakeCreativeWorker } from '../../services/creative-jobs.js';
import { localImageData, rasterType } from '../../services/creative-assets.js';
import { creativePlan } from '../../services/creative-plan.js';
import { fluxEnabled } from '../../services/flux-generator.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Uploads are served from our own origin, so only raster images are accepted (no html/svg).
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
async function saveImageUpload(req, dir, prefix) {
  const data = await req.file();
  if (!data) throw Object.assign(new Error('No file'), { statusCode: 400 });
  const ext = path.extname(data.filename || '').toLowerCase();
  if (!IMAGE_EXT.has(ext) || !String(data.mimetype || '').startsWith('image/')) {
    throw Object.assign(new Error('Нужна картинка JPG, PNG или WEBP'), { statusCode: 400 });
  }
  const buf = await data.toBuffer();
  const detected = rasterType(buf);
  const target = path.join(UPLOADS_DIR, dir);
  await fs.mkdir(target, { recursive: true });
  const filename = `${prefix}_${nanoid(16)}.${detected === 'jpeg' ? 'jpg' : detected}`;
  await fs.writeFile(path.join(target, filename), buf);
  return `/uploads/${dir}/${filename}`;
}

const REF_KEY = /^\/uploads\/references\/ref_[A-Za-z0-9_-]{16}\.(jpg|jpeg|png|webp)$/;
function cleanReferenceKeys(keys) {
  return (Array.isArray(keys) ? keys : []).filter(k => typeof k === 'string' && REF_KEY.test(k)).slice(0, 4);
}

// Accepts both our preset shape {idea, format:"1:1", count:"5"} and FA's {prompt, aspect_ratio, n}.
export function presetToGenerateBody(template = {}) {
  const t = typeof template === 'string' ? JSON.parse(template) : template;
  const ratio = String(t.format || t.aspect_ratio || '1x1').replace(':', 'x');
  return {
    headline: t.headline || t.idea || t.prompt || undefined,
    language: t.language || 'fr',
    format: ratio,
    count: Math.max(1, Math.min(10, Math.floor(Number(t.count ?? t.n ?? 3) || 3))),
    diversify: t.diversify,
    // FA logo keys live behind FA's Cloudflare; only our own uploads are usable here.
    logo_key: t.logo_key && !String(t.logo_key).startsWith('references/') ? t.logo_key : undefined,
    source: 'local',
  };
}

export async function startGeneration({ ws, userId, product, body, batchKey }) {
  if (batchKey !== undefined && (typeof batchKey !== 'string' || !batchKey || batchKey.length > 120)) throw new Error('Invalid internal creative batch key');
  const { language = 'fr', landing_price, features } = body;
  const { format, headline, styles: pickedStyles } = creativePlan(body);
  const logo_key = body.logo_key || null;
  if (logo_key && !/^\/uploads\/logos\/logo_[A-Za-z0-9_-]{16}\.(jpg|jpeg|png|webp)$/.test(logo_key)) throw Object.assign(new Error('Загрузите свой логотип'), { statusCode: 400 });
  if (logo_key) await localImageData(logo_key);
  const product_id = product.id;
  const references = cleanReferenceKeys(body.reference_keys);

  // Allow FLUX source only when API key is configured
  const requestedSource = body.source === 'flux' && fluxEnabled() ? 'flux' : 'local';

  const planned = pickedStyles.map((style, index) => ({
      id: `cr_${nanoid(20)}`,
      product_id,
      workspace_id: ws,
      created_by: userId,
      type: 'image',
      format,
      status: 'pending',
      metadata: { source: requestedSource, style, language, ...(batchKey ? {auto_batch_key:batchKey,auto_slot:index} : {}), options: { language, landing_price, features, format, headline, logo_key, image: references.length ? references[index % references.length] : undefined } },
    }));
  // One SQL statement: a failure must not leave a partially created batch.
  const { rows: records } = await db.query(`INSERT INTO creatives
    (id,product_id,workspace_id,created_by,type,format,status,metadata)
    SELECT id,product_id,workspace_id,created_by,type,format,status,metadata
    FROM jsonb_to_recordset($1::jsonb) AS batch(id text,product_id text,workspace_id text,
      created_by text,type text,format text,status text,metadata jsonb) ON CONFLICT DO NOTHING RETURNING *`, [JSON.stringify(planned)]);
  wakeCreativeWorker();
  return { creatives: records, total: records.length, source: requestedSource };
}

// Runs the creative preset chosen at scrape time once the product has data.
export async function generateFromScrapePreset(productId, { batchKey } = {}) {
  const product = await db.findOne('products', { id: productId });
  if (!product?.creative_preset_id) return;
  const preset = await db.findOne('creative_presets', { id: product.creative_preset_id, workspace_id: product.workspace_id });
  if (!preset) return;
  await startGeneration({
    ws: product.workspace_id,
    userId: product.created_by,
    product,
    body: presetToGenerateBody(preset.template),
    batchKey,
  });
}

export async function creativeRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // List creatives
  app.get('/', auth, async (req) => {
    const { product_id, status } = req.query;
    const { ws } = req.user;
    if (product_id) await assertProductAccess(req, product_id);

    let sql = `SELECT * FROM creatives WHERE workspace_id = $1`;
    const vals = [ws];
    let i = 2;
    if (ownUser(req)) { sql += ` AND created_by = $${i++}`; vals.push(req.user.id); }
    if (product_id) { sql += ` AND product_id = $${i++}`; vals.push(product_id); }
    if (status) { sql += ` AND status = $${i++}`; vals.push(status); }
    sql += ' ORDER BY created_at DESC';

    const { rows } = await db.query(sql, vals);
    return rows;
  });

  // Own templates for every product, including records imported in the past.
  app.post('/generate', auth, async (req) => {
    const { ws, id: userId } = req.user;
    const product = await db.findOne('products', { id: req.body.product_id, workspace_id: ws });
    if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });
    await assertProductAccess(req, product.id);
    return startGeneration({ ws, userId, product, body: req.body });
  });

  // Info endpoint вЂ” which source is active
  app.get('/source', auth, async () => ({
    fa_available: false,
    active: fluxEnabled() ? 'flux' : 'local',
    engine: fluxEnabled() ? 'flux-ai' : 'own',
    renderer: fluxEnabled() ? 'fal-ai/flux/schnell' : 'html-templates',
    generative_ai: fluxEnabled(),
    supported_scrapers: ['amazon', 'walmart'],
  }));

  // Upload logo for creative generation
  app.post('/upload-logo', auth, async (req) => {
    const key = await saveImageUpload(req, 'logos', 'logo');
    return { key, url: key };
  });

  app.post('/upload-reference', auth, async (req) => {
    const key = await saveImageUpload(req, 'references', 'ref');
    return { key, url: key };
  });

  // Retry through our own renderer; no external product ID is required.
  app.post('/:id/retry', auth, async (req, reply) => {
    const creative = await db.findOne('creatives', { id: req.params.id, workspace_id: req.user.ws });
    if (!creative) return reply.status(404).send({ error: 'Not found' });
    if (req.user.role === 'buyer' && creative.created_by !== req.user.id) return reply.status(403).send({ error: 'Р­С‚Рѕ РЅРµ РІР°С€ РєСЂРµР°С‚РёРІ' });
    if (creative.status !== 'failed') return reply.status(400).send({ error: 'Only failed creatives can be retried' });

    const product = await db.findOne('products', { id: creative.product_id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    await assertProductAccess(req, product.id);
    const metadata = { ...creative.metadata, error: null, image_pending: false };
    const { rowCount } = await db.query(`UPDATE creatives SET status='pending',metadata=$1::jsonb,
      render_attempts=0,render_token=NULL,render_started_at=NULL
      WHERE id=$2 AND workspace_id=$3 AND status='failed'`, [JSON.stringify(metadata),creative.id,req.user.ws]);
    if (!rowCount) return reply.status(409).send({ error: 'РџРѕРІС‚РѕСЂ СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ' });
    wakeCreativeWorker();

    return { ok: true };
  });

  // Toggle favorite
  app.patch('/:id/favorite', auth, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE creatives SET favorite = NOT favorite WHERE id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR created_by = $3) RETURNING favorite`,
      [req.params.id, req.user.ws, ownUser(req)]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Not found' });
    return { favorite: rows[0].favorite };
  });

  // Template rendering has no FA usage bill. Null means not measured, not zero cost.
  app.get('/spend', auth, async () => ({ total_usd: null, count: 0, source: fluxEnabled() ? 'flux' : 'local' }));
  // Legacy URLs are explicit retired features; never contact an external service.
  const retired = async (req, reply) => reply.status(410).send({ error: 'FA РѕС‚РєР»СЋС‡С‘РЅ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃРѕР±СЃС‚РІРµРЅРЅС‹Рµ РєСЂРµР°С‚РёРІС‹.', code: 'FA_DISABLED' });
  app.get('/ready-images', auth, retired);
  app.post('/import-ready/:genId', auth, retired);
  app.get('/fa-ready', auth, async () => ({ ready: [], pending: [], disabled: true }));

  // Delete creatives (bulk)
  // Buyers delete only their own creatives.
  app.delete('/', auth, async (req) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ownOnly = req.user.role === 'buyer' ? req.user.id : null;
    const { rowCount } = await db.query(
      `DELETE FROM creatives WHERE id = ANY($1) AND workspace_id = $2 AND ($3::text IS NULL OR created_by = $3)`,
      [ids, req.user.ws, ownOnly]
    );
    return { ok: true, deleted: rowCount, skipped: ids.length - rowCount };
  });
}
