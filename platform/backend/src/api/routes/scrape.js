import { assertProductAccess, assertFolderAccess, assertRecordAccess } from '../../middleware/access.js';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { enqueueOwnScrape } from '../../services/scrape-jobs.js';
import { currentEngine, parseProductLink } from '../../services/engine.js';

function badRequest(msg) {
  return Object.assign(new Error(msg), { statusCode: 400 });
}

async function loadPresetBundles(ws, presetId) {
  if (!presetId) return [];
  const preset = await db.findOne('bundle_presets', { id: presetId, workspace_id: ws });
  if (!preset) throw badRequest('Пресет комплектов не найден');
  const config = typeof preset.config === 'string' ? JSON.parse(preset.config) : preset.config;
  return Array.isArray(config) ? config : [];
}

function parseBundles(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function logScrapeError(err) {
  console.error('[scrape]', err?.message || err);
}

// Folder and presets a scrape refers to must be the caller's (same rules as everywhere: access.js).
async function assertScrapeRefs(req, folderId, bundlePresetId, creativePresetId) {
  await assertFolderAccess(req, folderId);
  if (bundlePresetId) await assertRecordAccess(req, 'bundle_presets', bundlePresetId);
  if (creativePresetId) await assertRecordAccess(req, 'creative_presets', creativePresetId);
}

async function assertCreativePreset(ws, id) {
  if (!id) return null;
  const preset = await db.findOne('creative_presets', { id, workspace_id: ws });
  if (!preset) throw badRequest('Пресет креативов не найден');
  return id;
}

async function createPlaceholder({ ws, userId, link, engine, folderId, presetId, bundles, creativePresetId }) {
  return db.insert('products', {
    id: `prd_${nanoid(20)}`,
    workspace_id: ws,
    folder_id: folderId || null,
    created_by: userId,
    source: link.source,
    source_id: link.asin || null,
    marketplace: link.marketplace || null,
    source_url: link.url,
    bundle_preset_id: presetId || null,
    creative_preset_id: creativePresetId || null,
    bundle_config: JSON.stringify(bundles),
    engine,
    status: 'draft',
    scrape_status: 'processing',
    scrape_started_at: new Date(),
  });
}

/* ───── own engine: Amazon pages opened by the Mac agent in an AdsPower profile ───── */

// The job is stored on the product; its result is applied in routes/agent.js when the agent reports,
// and services/scrape-jobs.js recovers results after a restart.
// Shops the own engine scrapes; a Walmart link must point at a product (/ip/…/<item id>).
const OWN_SOURCES = new Set(['amazon', 'walmart', 'target', 'bestbuy', 'etsy']);
const ownScrapable = (link) => OWN_SOURCES.has(link.source) && !!link.asin;

function runOwnScrape(ws, productId, asin, marketplace, source = 'amazon', sourceUrl) {
  enqueueOwnScrape(ws, productId, asin, marketplace, source, sourceUrl).catch(async (err) => {
    logScrapeError(err);
    await db.update('products', productId, {
      scrape_status: 'failed',
      scrape_error: String(err?.message || 'Неизвестная ошибка').slice(0, 500),
    }).catch(logScrapeError);
  });
}

async function startScrapes({ ws, userId, inputs, marketplace, folderId, presetId, creativePresetId, dryRun = false }) {
  const engine = currentEngine();
  const links = inputs.map(s => ({ input: s, link: parseProductLink(s, marketplace) }));
  const bad = links.filter(l => !l.link).map(l => l.input);
  if (bad.length) throw badRequest('Не распознаны ссылки (нужны Amazon, Walmart, Target, Best Buy или Etsy): ' + bad.join(', '));
  const unsupported = links.filter(l => !ownScrapable(l.link)).map(l => l.input);
  if (unsupported.length) throw badRequest('Свой движок скрапит Amazon, Walmart, Target, Best Buy и Etsy (walmart.com/ip/…); нужна прямая ссылка на конкретный товар: ' + unsupported.join(', '));

  const bundles = await loadPresetBundles(ws, presetId);
  await assertCreativePreset(ws, creativePresetId);
  if (dryRun) return { engine, links: links.map(l => l.link), bundles };
  const products = [];
  for (const { link } of links) {
    products.push(await createPlaceholder({ ws, userId, link, engine, folderId, presetId, bundles, creativePresetId }));
  }

  products.forEach(p => runOwnScrape(ws, p.id, p.source_id, p.marketplace, p.source, p.source_url));

  return { engine, products };
}

export async function scrapeRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.post('/product', auth, async (req) => {
    const { ws, id: userId } = req.user;
    const { asin, link, marketplace = 'fr', folder_id, bundle_preset_id, creative_preset_id } = req.body;
    await assertScrapeRefs(req, folder_id, bundle_preset_id, creative_preset_id);
    const { engine, products } = await startScrapes({
      ws, userId, inputs: [link || asin].filter(Boolean), marketplace, folderId: folder_id,
      presetId: bundle_preset_id, creativePresetId: creative_preset_id,
    });
    return { product_id: products[0].id, status: 'processing', engine };
  });

  // `links` — product URLs or ASINs; `asins` kept for older clients
  app.post('/bulk', auth, async (req) => {
    const { ws, id: userId } = req.user;
    const { links, asins, marketplace = 'fr', folder_id, bundle_preset_id, creative_preset_id } = req.body;
    const inputs = (Array.isArray(links) ? links : Array.isArray(asins) ? asins : []).map(s => String(s).trim()).filter(Boolean);
    if (!inputs.length) throw badRequest('Нужна хотя бы одна ссылка');
    if (inputs.length > 50) throw badRequest('Не больше 50 ссылок за раз');
    await assertScrapeRefs(req, folder_id, bundle_preset_id, creative_preset_id);

    // ?dry_run=1: every check, nothing created (used to validate MCP drafts).
    const dryRun = req.query?.dry_run === '1';
    const started = await startScrapes({
      ws, userId, inputs, marketplace, folderId: folder_id, presetId: bundle_preset_id, creativePresetId: creative_preset_id, dryRun,
    });
    if (dryRun) return { ok: true, links: started.links, bundles: started.bundles };
    const { engine, products } = started;
    return {
      engine,
      total: products.length,
      jobs: products.map(p => ({ product_id: p.id, source: p.source, asin: p.source_id, marketplace: p.marketplace })),
    };
  });

  app.get('/engine', auth, async () => ({ engine: currentEngine(), supported_sources: [...OWN_SOURCES] }));

  app.get('/status/:productId', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.productId);
    const product = await db.findOne('products', { id: req.params.productId, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Not found' });
    return { id: product.id, scrape_status: product.scrape_status, scrape_error: product.scrape_error, title: product.title };
  });

  // Retry: re-runs the scrape with the engine that is active now.
  app.post('/retry/:id', auth, async (req, reply) => {
    await assertProductAccess(req, req.params.id);
    const product = await db.findOne('products', { id: req.params.id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Not found' });
    const link = parseProductLink(product.source_url || product.source_id, product.marketplace || 'fr');
    if (!link) return reply.status(400).send({ error: 'У товара нет корректной ссылки — удали его и соскрапь заново' });

    const engine = currentEngine();
    if (!ownScrapable(link)) {
      return reply.status(400).send({ error: 'Свой движок скрапит Amazon, Walmart, Target, Best Buy и Etsy; нужна прямая ссылка на конкретный товар' });
    }
    await db.update('products', product.id, {
      engine,
      external_id: null,
      source: link.source,
      source_id: link.asin || null,
      marketplace: link.marketplace || null,
      source_url: link.url,
      scrape_status: 'processing',
      scrape_error: null,
      scrape_started_at: new Date(),
    });
    runOwnScrape(req.user.ws, product.id, link.asin, link.marketplace, link.source, link.url);

    return { ok: true, status: 'processing', engine };
  });

  // FA's similar-products search is paid and needs geo, period and price range — not wired to the UI yet.
  app.get('/similar/:id', auth, async () => []);
}
