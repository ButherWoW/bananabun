import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs/promises';
import { db } from '../../db/client.js';
import { generateCreative } from '../../services/creative-generator.js';
import { faAvailable, faImagesAvailable, faGetCreative, faStartGeneration, faPollGeneration, faDownloadImage, faCreativeSpend, faCreativeOptions } from '../../services/fa-client.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Aspect ratio label → FA format string
const FORMAT_TO_FA = { '1x1': '1:1', '3x2': '3:2', '2x3': '2:3', '1:1': '1:1', '3:2': '3:2', '2:3': '2:3' };

async function saveFaImage(genUrl) {
  if (!genUrl || !faImagesAvailable()) return null;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `cr_${nanoid(16)}.png`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), await faDownloadImage(genUrl));
  return `/uploads/${filename}`;
}

// FA returns one generation id per image; each image becomes its own creative row.
async function generateViaFA(record, product, opts) {
  const { language, count, format, prompt, logo_key, landing_template_id, diversify, ws, userId } = opts;
  try {
    const genIds = await faStartGeneration({
      product_id: product.external_id,
      language,
      n: count,
      aspect_ratio: FORMAT_TO_FA[format] || '1:1',
      prompt,
      logo_key,
      landing_template_id,
      diversify,
    });

    const records = [record];
    for (const genId of genIds.slice(1)) {
      records.push(await db.insert('creatives', {
        id: `cr_${nanoid(20)}`,
        product_id: record.product_id,
        workspace_id: ws,
        created_by: userId,
        type: 'image',
        format,
        status: 'processing',
        metadata: JSON.stringify({ source: 'fa', language, generation_id: genId }),
      }));
    }

    await Promise.all(genIds.map(async (genId, i) => {
      const rec = records[i];
      try {
        const gen = await faPollGeneration(genId);
        const remoteUrl = gen.url || gen.images?.[0]?.url || null;
        const fileUrl = await saveFaImage(remoteUrl);
        await db.update('creatives', rec.id, {
          file_url: fileUrl,
          thumbnail_url: fileUrl,
          status: 'done',
          metadata: JSON.stringify({
            source: 'fa',
            language,
            generation_id: genId,
            fa_url: remoteUrl,
            image_pending: !fileUrl,
            ...(gen.name ? { name: gen.name } : {}),
            ...(gen.cost_usd != null ? { cost_usd: gen.cost_usd } : {}),
          }),
        });
      } catch (err) {
        await db.update('creatives', rec.id, {
          status: 'failed',
          metadata: JSON.stringify({ source: 'fa', language, generation_id: genId, error: err.message }),
        });
      }
    }));
  } catch (err) {
    console.error('[FA creative] failed:', err.message);
    await db.update('creatives', record.id, {
      status: 'failed',
      metadata: JSON.stringify({ source: 'fa', language, error: err.message }),
    });
  }
}

async function generateViaPlaywright(record, product, opts) {
  const { language, landing_price, style, features, format, image } = opts;
  try {
    const result = await generateCreative(product, null, format, { language, landing_price, style, features, image });
    if (result) {
      await db.update('creatives', record.id, {
        file_url: result.url,
        thumbnail_url: result.thumbnail,
        status: 'done',
        metadata: { source: 'local', style: result.style, language: result.language },
      });
    } else {
      await db.update('creatives', record.id, { status: 'failed' });
    }
  } catch (err) {
    console.error('[local creative] failed:', err.message);
    await db.update('creatives', record.id, { status: 'failed' });
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
    count: Math.max(1, Math.min(10, Number(t.count ?? t.n ?? 3) || 3)),
    diversify: t.diversify,
    // FA logo keys live behind FA's Cloudflare; only our own uploads are usable here.
    logo_key: t.logo_key && !String(t.logo_key).startsWith('references/') ? t.logo_key : undefined,
    landing_template_id: t.landing_template_id || undefined,
  };
}

export async function startGeneration({ ws, userId, product, body }) {
  const {
    language = 'fr',
    landing_price,
    styles,         // for local mode: ['clean','dark',...]
    count = 3,
    features,
    format = '1x1',
    prompt: promptField,
    idea,
    logo_key,
    landing_template_id,
    source,         // 'fa' | 'local' | auto-detect
  } = body;
  const prompt = promptField || idea;
  const product_id = product.id;
  const references = cleanReferenceKeys(body.reference_keys);

  const isFaProduct = product.engine === 'fa' && !!product.external_id;
  if (source === 'fa' && !isFaProduct) {
    throw Object.assign(new Error('Товар не связан с FA — пересоскрапь его, чтобы генерировать креативы в FA'), { statusCode: 400 });
  }
  const useFa = source !== 'local' && isFaProduct && faAvailable();

  if (useFa) {
    // FA: one record per generation (FA generates `count` images in one request)
    const record = await db.insert('creatives', {
      id: `cr_${nanoid(20)}`,
      product_id,
      workspace_id: ws,
      created_by: userId,
      type: 'image',
      format,
      status: 'processing',
      metadata: { source: 'fa', language },
    });
    // FA knows only its own template ids (mtpl_…) and its own logo keys; ours would break the request.
    const faTemplate = String(landing_template_id || '').startsWith('mtpl_') ? landing_template_id : undefined;
    const faLogo = logo_key && !String(logo_key).startsWith('/uploads/') ? logo_key : undefined;
    generateViaFA(record, product, { language, count, format, prompt, logo_key: faLogo, landing_template_id: faTemplate, diversify: body.diversify, ws, userId })
      .catch(console.error);
    return { creatives: [record], total: 1, source: 'fa' };
  }

  // Local Playwright: one record per style, sequential
  const STYLES_ALL = ['clean', 'dark', 'gradient', 'bold', 'minimal'];
  const pickedStyles = styles || STYLES_ALL.slice(0, Math.min(count, 5));
  const records = await Promise.all(pickedStyles.map(style =>
    db.insert('creatives', {
      id: `cr_${nanoid(20)}`,
      product_id,
      workspace_id: ws,
      created_by: userId,
      type: 'image',
      format,
      status: 'processing',
      metadata: { source: 'local', style, language },
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

  // Generate creatives — FA if configured, else local Playwright
  app.post('/generate', auth, async (req) => {
    const { ws, id: userId } = req.user;
    const product = await db.findOne('products', { id: req.body.product_id, workspace_id: ws });
    if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });
    return startGeneration({ ws, userId, product, body: req.body });
  });

  // Info endpoint — which source is active
  app.get('/source', auth, async () => ({
    fa_available: faAvailable(),
    active: faAvailable() ? 'fa' : 'local',
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

  // Retry failed FA generation
  app.post('/:id/retry', auth, async (req, reply) => {
    const creative = await db.findOne('creatives', { id: req.params.id, workspace_id: req.user.ws });
    if (!creative) return reply.status(404).send({ error: 'Not found' });
    if (creative.status !== 'failed') return reply.status(400).send({ error: 'Only failed creatives can be retried' });

    const product = await db.findOne('products', { id: creative.product_id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    const language = creative.metadata?.language || 'fr';
    const format = creative.format || '1:1';

    if (product.engine !== 'fa' || !product.external_id) {
      return reply.status(400).send({ error: 'Товар не связан с FA — пересоскрапь его' });
    }
    await db.update('creatives', creative.id, { status: 'processing', metadata: { ...creative.metadata, error: undefined } });
    generateViaFA(creative, product, { language, count: 1, format, ws: req.user.ws, userId: req.user.id }).catch(console.error);

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

  // Creative spend counter
  app.get('/spend', auth, async () => {
    if (!faAvailable()) return { total_usd: null, count: 0 };
    try {
      return await faCreativeSpend();
    } catch {
      return { total_usd: null, count: 0 };
    }
  });

  // FA ready images (pending/completed generations)
  app.get('/ready-images', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(503).send({ error: 'FA not configured' });
    try {
      const data = await faCreativeOptions();
      return { items: data.ready_images?.items || [] };
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // Import a ready image from FA by generation_id
  app.post('/import-ready/:genId', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(503).send({ error: 'FA not configured' });
    const { genId } = req.params;
    const { product_id } = req.body;
    const { ws, id: userId } = req.user;
    try {
      const gen = await faGetCreative(genId);
      if (gen.status !== 'ready' && gen.status !== 'done') throw new Error('Генерация в FA ещё не готова');
      const imageUrl = gen.url || gen.images?.[0]?.url;
      if (!imageUrl) throw new Error('No image URL in generation');

      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      const buf = await faDownloadImage(imageUrl);
      const filename = `cr_${nanoid(16)}.jpg`;
      await fs.writeFile(path.join(UPLOADS_DIR, filename), buf);
      const thumbBuf = await faDownloadImage(gen.thumbnail_url || imageUrl);
      const thumbname = `thumb_${filename}`;
      await fs.writeFile(path.join(UPLOADS_DIR, thumbname), thumbBuf);

      const record = await db.insert('creatives', {
        id: `cr_${nanoid(20)}`,
        product_id: product_id || null,
        workspace_id: ws,
        created_by: userId,
        type: 'image',
        format: gen.aspect_ratio || '1:1',
        status: 'done',
        file_url: `/uploads/${filename}`,
        thumbnail_url: `/uploads/${thumbname}`,
        metadata: { source: 'fa_ready', generation_id: genId, ...(gen.name ? { name: gen.name } : {}) },
      });
      return record;
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // FA ready/pending creatives (both ready_images and pending_images)
  app.get('/fa-ready', auth, async () => {
    if (!faAvailable()) return { ready: [], pending: [] };
    try {
      const data = await faCreativeOptions();
      return {
        ready: data.ready_images?.items || data.ready_images || [],
        pending: data.pending_images?.items || data.pending_images || [],
      };
    } catch {
      return { ready: [], pending: [] };
    }
  });

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
