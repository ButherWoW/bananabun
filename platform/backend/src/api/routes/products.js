import { assertProductAccess, assertFolderAccess, assertRecordAccess } from '../../middleware/access.js';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { rasterType } from '../../services/creative-assets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR ? resolve(process.env.UPLOADS_DIR) : join(__dirname, '..', '..', '..', 'uploads');
const IMAGES_DIR = join(UPLOADS_DIR, 'images');

function cleanSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs
    .map(s => ({ label: String(s?.label || '').trim().slice(0, 200), value: String(s?.value || '').trim().slice(0, 1000) }))
    .filter(s => s.label && s.value)
    .slice(0, 100);
}

export async function productRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // List products (with pagination + filters)
  app.get('/', auth, async (req) => {
    const { ws } = req.user;
    const { folder_id, status, scrape_status, search, sort = 'new' } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const isBuyer = req.user.role === 'buyer';
    let sql = `SELECT p.*, u.name as author_name FROM products p
               LEFT JOIN users u ON p.created_by = u.id
               WHERE p.workspace_id = $1`;
    const vals = [ws];
    let i = 2;

    // Sharing a category must not disclose another buyer's products.
    if (isBuyer) {
      sql += ` AND p.created_by = $${i}`;
      i++; vals.push(req.user.id);
    }
    if (folder_id === 'none') sql += ` AND p.folder_id IS NULL`;
    else if (folder_id) { sql += ` AND p.folder_id = $${i++}`; vals.push(folder_id); }
    if (status) { sql += ` AND p.status = $${i++}`; vals.push(status); }
    if (scrape_status) { sql += ` AND p.scrape_status = $${i++}`; vals.push(scrape_status); }
    if (search) { sql += ` AND (p.title ILIKE $${i} OR p.source_id ILIKE $${i} OR p.source_url ILIKE $${i})`; i++; vals.push(`%${search}%`); }

    const { rows: [{ count }] } = await db.query(
      sql.replace('SELECT p.*, u.name as author_name', 'SELECT COUNT(*)'), vals
    );

    const ORDER = { new: 'p.created_at DESC', old: 'p.created_at ASC', name: 'p.title ASC NULLS LAST' };
    sql += ` ORDER BY ${ORDER[sort] || ORDER.new} LIMIT $${i++} OFFSET $${i++}`;
    vals.push(limit, offset);

    const { rows } = await db.query(sql, vals);
    const items = rows.map(r => {
      const imgs = Array.isArray(r.images) ? r.images : [];
      return { ...r, images: imgs, images_count: imgs.length };
    });
    return { items, total: Number(count), page: Number(page), limit: Number(limit) };
  });

  // Get single product
  app.get('/:id', auth, async (req, reply) => {
    const product = await db.findOne('products', { id: req.params.id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Not found' });
    await assertProductAccess(req, product.id);
    return product;
  });

  // Create product (manual)
  app.post('/', auth, async (req) => {
    const { ws, id: userId } = req.user;
    const { folder_id, title, description, specs, source_price, bundle_preset_id } = req.body || {};
    if (!title || !String(title).trim()) throw Object.assign(new Error('Нужен заголовок'), { statusCode: 400 });
    await assertFolderAccess(req, folder_id);
    if (bundle_preset_id) await assertRecordAccess(req, 'bundle_presets', bundle_preset_id);
    return db.insert('products', {
      id: `prd_${nanoid(20)}`,
      workspace_id: ws,
      folder_id: folder_id || null,
      created_by: userId,
      source: 'manual',
      engine: 'own',
      title: String(title).trim(),
      description: description || null,
      specs: JSON.stringify(cleanSpecs(specs)),
      source_price: source_price ? Number(source_price) : null,
      images: JSON.stringify([]),
      bundle_preset_id: bundle_preset_id || null,
      status: 'draft',
      scrape_status: 'done',
    });
  });

  // Update product
  app.patch('/:id', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const product = await db.findOne('products', { id: req.params.id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Not found' });

    const allowed = ['title', 'description', 'source_price', 'bundle_config', 'bundle_preset_id',
                     'folder_id', 'status', 'images', 'rating', 'reviews_count', 'specs'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (data.folder_id) await assertFolderAccess(req, data.folder_id);
    if (data.bundle_preset_id) await assertRecordAccess(req, 'bundle_presets', data.bundle_preset_id);
    if (data.specs !== undefined) data.specs = JSON.stringify(cleanSpecs(data.specs));

    return db.update('products', product.id, data);
  });

  // Bulk edit products (status / tags)
  app.patch('/bulk', auth, async (req, reply) => {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || !ids.length) return reply.status(400).send({ error: 'ids required' });
    await assertProductAccess(req, ids);
    const { ws } = req.user;
    const allowed = ['status', 'tags', 'notes'];
    const fields = Object.keys(updates || {}).filter(k => allowed.includes(k));
    if (!fields.length) return reply.status(400).send({ error: 'No valid fields to update' });
    const setClauses = [];
    const vals = [ws, ids];
    let i = 3;
    for (const field of fields) {
      if (field === 'tags') {
        setClauses.push(`tags = $${i++}`);
        vals.push(JSON.stringify(updates.tags));
      } else {
        setClauses.push(`${field} = $${i++}`);
        vals.push(updates[field]);
      }
    }
    await db.query(
      `UPDATE products SET ${setClauses.join(', ')}, updated_at = NOW() WHERE workspace_id = $1 AND id = ANY($2)`,
      vals
    );
    return { ok: true, updated: ids.length };
  });

  // Delete products (bulk)
  app.delete('/', auth, async (req) => {
    const { ids } = req.body;
    await assertProductAccess(req, ids);
    const { ws } = req.user;
    await db.query(
      `DELETE FROM products WHERE id = ANY($1) AND workspace_id = $2`,
      [ids, ws]
    );
    return { ok: true, deleted: ids.length };
  });

  // Move to folder (bulk)
  app.post('/move', auth, async (req) => {
    const { ids, folder_id } = req.body;
    await assertFolderAccess(req, folder_id);
    await assertProductAccess(req, ids);
    const { ws } = req.user;
    await db.query(
      `UPDATE products SET folder_id = $1, updated_at = NOW() WHERE id = ANY($2) AND workspace_id = $3`,
      [folder_id, ids, ws]
    );
    return { ok: true, moved: ids.length };
  });

  // Translate field (title/description) to Russian via simple approach
  app.post('/:id/translate', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const { field, text, target = 'ru' } = req.body;
    // Use MyMemory free translation API
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=fr|ru&de=noreply@example.com`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      const translated = d?.responseData?.translatedText || text;
      return { translated, field };
    } catch {
      return reply.status(500).send({ error: 'Translation failed' });
    }
  });

  // Upload images to product
  app.post('/:id/images', { onRequest: [app.authenticate] }, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const product = await db.findOne('products', { id: req.params.id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Not found' });

    const parts = req.parts();
    const newUrls = [];
    await mkdir(IMAGES_DIR, { recursive: true });

    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        const detected = rasterType(buf);
        if (!detected) continue; // skip non-image bytes silently
        const ext = detected === 'jpeg' ? 'jpg' : detected;
        const filename = `${product.source_id || nanoid(8)}-custom-${nanoid(6)}.${ext}`;
        const filepath = join(IMAGES_DIR, filename);
        await writeFile(filepath, buf);
        newUrls.push(`/uploads/images/${filename}`);
      }
    }

    const existing = Array.isArray(product.images) ? product.images : [];
    const updated = [...existing, ...newUrls];
    await db.update('products', product.id, { images: JSON.stringify(updated) });
    return { images: updated };
  });

  // Reviews
  app.get('/:id/reviews', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const { rows } = await db.query(
      `SELECT r.* FROM product_reviews r JOIN products p ON p.id = r.product_id
        WHERE r.product_id = $1 AND p.workspace_id = $2 ORDER BY r.created_at DESC`,
      [req.params.id, req.user.ws]
    );
    return rows;
  });

  app.post('/:id/reviews', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const { author, rating, text, images } = req.body || {};
    if (!String(text || '').trim()) return reply.status(400).send({ error: 'Нужен текст отзыва' });
    // Only a real 1–5 rating; none given stays empty (no stars), never a default 5.
    const r = Math.round(Number(rating));
    const review = await db.insert('product_reviews', {
      id: `rev_${nanoid(20)}`,
      product_id: req.params.id,
      author: author || 'Аноним',
      rating: r >= 1 && r <= 5 ? r : null,
      text,
    });
    // products.reviews_count is the marketplace's count (scraped) — not the number of reviews added here.
    return review;
  });


  // Scrape reviews on demand from Amazon via ScraperAPI
  app.post('/:id/reviews/scrape', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const product = await db.findOne('products', { id: req.params.id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Товар не найден' });
    if (!product.source_id) return reply.status(400).send({ error: 'У товара нет ASIN' });
    const { scrapeAmazonReviewsViaScraperApi, scraperApiEnabled } = await import('../../services/scraper-walmart-api.js');
    if (!scraperApiEnabled()) return reply.status(400).send({ error: 'SCRAPER_API_KEY не настроен' });
    const fetched = await scrapeAmazonReviewsViaScraperApi(product.source_id, product.marketplace || 'fr');
    if (!fetched?.length) return [];
    // Delete old scraped reviews, insert fresh ones
    await db.query('DELETE FROM product_reviews WHERE product_id = $1 AND scraped = true', [product.id]);
    const saved = [];
    for (const rv of fetched.slice(0, 10)) {
      if (!rv.text) continue;
      const review = await db.insert('product_reviews', {
        id: `rev_${nanoid(20)}`,
        product_id: product.id,
        author: rv.author,
        rating: rv.rating,
        text: rv.text,
        images: JSON.stringify(rv.images || []),
        scraped: true,
      });
      saved.push(review);
    }
    return saved;
  });
  app.delete('/:id/reviews/:rid', auth, async (req) => {
    await assertProductAccess(req, req.params.id);
    await db.query(
      `DELETE FROM product_reviews WHERE id = $1 AND product_id = $2`,
      [req.params.rid, req.params.id]
    );
    return { ok: true };
  });
}
