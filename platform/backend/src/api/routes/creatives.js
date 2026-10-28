import { assertProductAccess } from '../../middleware/access.js';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs/promises';
import { db } from '../../db/client.js';
import { generateCreative } from '../../services/creative-generator.js';
import { creativePlan } from '../../services/creative-plan.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

async function generateViaPlaywright(record, product, opts) {
  const { language, landing_price, style, features, format, image } = opts;
  try {
    const result = await generateCreative(product, null, format, { language, landing_price, style, features, image });
    if (result) {
      await db.update('creatives', record.id, {
        file_url: result.url,
        thumbnail_url: result.thumbnail,
        status: 'done',
        metadata: { ...record.metadata, source: 'local', style: result.style, language: result.language },
      });
    } else {
      await db.update('creatives', record.id, { status: 'failed', metadata: { ...record.metadata, error: 'Собственный движок не смог создать изображение. Проверьте фото товара и Chromium.' } });
    }
  } catch (err) {
    console.error('[local creative] failed:', err.message);
    await db.update('creatives', record.id, { status: 'failed', metadata: { ...record.metadata, error: err.message } });
  }
}

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
  const target = path.join(UPLOADS_DIR, dir);
  await fs.mkdir(target, { recursive: true });
  const filename = `${prefix}_${nanoid(16)}${ext}`;
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
    prompt: t.prompt || t.idea || undefined,
    language: t.language || 'fr',
    format: ratio,
    count: Math.max(1, Math.min(10, Math.floor(Number(t.count ?? t.n ?? 3) || 3))),
    diversify: t.diversify,
    // FA logo keys live behind FA's Cloudflare; only our own uploads are usable here.
    logo_key: t.logo_key && !String(t.logo_key).startsWith('references/') ? t.logo_key : undefined,
    landing_template_id: t.landing_template_id || undefined,
  };
}

export async function startGeneration({ ws, userId, product, body }) {
  const { language = 'fr', landing_price, features } = body;
  const { format, styles: pickedStyles } = creativePlan(body);
  const product_id = product.id;
  const references = cleanReferenceKeys(body.reference_keys);
  const records = await Promise.all(pickedStyles.map((style, index) =>
    db.insert('creatives', {
      id: `cr_${nanoid(20)}`,
      product_id,
      workspace_id: ws,
      created_by: userId,
      type: 'image',
      format,
      status: 'processing',
      metadata: { source: 'local', style, language, options: { language, landing_price, features, format, image: references.length ? references[index % references.length] : undefined } },
    })
  ));
  // Sequential to avoid Playwright crashes
  (async () => {
    for (let i = 0; i < records.length; i++) {
      await generateViaPlaywright(records[i], product, {
        language, landing_price, style: pickedStyles[i], features, format,
        image: references.length ? references[i % references.length] : undefined,
      });
    }
  })().catch(console.error);
  return { creatives: records, total: records.length, source: 'local' };
}

// Runs the creative preset chosen at scrape time once the product has data.
export async function generateFromScrapePreset(productId) {
  const product = await db.findOne('products', { id: productId });
  if (!product?.creative_preset_id) return;
  const preset = await db.findOne('creative_presets', { id: product.creative_preset_id, workspace_id: product.workspace_id });
  if (!preset) return;
  await startGeneration({
    ws: product.workspace_id,
    userId: product.created_by,
    product,
    body: presetToGenerateBody(preset.template),
  });
}

export async function creativeRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // List creatives
  app.get('/', auth, async (req) => {
    const { product_id, status } = req.query;
    const { ws } = req.user;

    let sql = `SELECT * FROM creatives WHERE workspace_id = $1`;
    const vals = [ws];
    let i = 2;
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

  // Info endpoint — which source is active
  app.get('/source', auth, async () => ({
    fa_available: false,
    active: 'local',
    engine: 'own',
    renderer: 'html-templates',
    generative_ai: false,
    supported_scrapers: ['amazon'],
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
    if (req.user.role === 'buyer' && creative.created_by !== req.user.id) return reply.status(403).send({ error: 'Это не ваш креатив' });
    if (creative.status !== 'failed') return reply.status(400).send({ error: 'Only failed creatives can be retried' });

    const product = await db.findOne('products', { id: creative.product_id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    const language = creative.metadata?.language || 'fr';
    const format = creative.format || '1:1';

    await assertProductAccess(req, product.id);
    const metadata = { ...creative.metadata, source: 'local', error: null, image_pending: false };
    await db.update('creatives', creative.id, { status: 'processing', metadata });
    generateViaPlaywright({ ...creative, metadata }, product, {
      ...creative.metadata?.options, language, format: format.replace(':', 'x'), style: creative.metadata?.style,
    }).catch(console.error);

    return { ok: true };
  });

  // Toggle favorite
  app.patch('/:id/favorite', auth, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE creatives SET favorite = NOT favorite WHERE id = $1 AND workspace_id = $2 RETURNING favorite`,
      [req.params.id, req.user.ws]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Not found' });
    return { favorite: rows[0].favorite };
  });

  // Template rendering has no FA usage bill. Null means not measured, not zero cost.
  app.get('/spend', auth, async () => ({ total_usd: null, count: 0, source: 'local' }));
  // Legacy URLs are explicit retired features; never contact an external service.
  const retired = async (req, reply) => reply.status(410).send({ error: 'FA отключён. Используйте собственные креативы.', code: 'FA_DISABLED' });
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
