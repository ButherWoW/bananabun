import { db } from '../db/client.js';
import { enqueueAgentJob } from '../api/routes/agent.js';
import { amazonUrl, withRealOldPrice, MARKET_CURRENCY, parseProductLink } from './engine.js';
import { AMAZON_MARKETS, productFromAgentData } from './scraper.js';
import { scrapeWalmartViaScraperApi, scrapeAmazonViaScraperApi, scraperApiEnabled } from './scraper-walmart-api.js';

// Own Amazon scrape that survives a backend restart: the product↔job link is stored
// (products.scrape_job_id), the agent's result is applied when it arrives (routes/agent.js),
// and a sweep at start and every 2 minutes applies results that arrived while nobody applied them
// and fails scrapes that can no longer finish.

const STUCK_MIN = 15;

function parseBundles(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

// Own engine: Amazon (any of our marketplaces) and Walmart (walmart.com item id).
export async function enqueueOwnScrape(ws, productId, asin, marketplace, source = 'amazon', sourceUrl) {
  let type, url;
  if (source === 'walmart') {
    if (!/^\d{5,15}$/.test(String(asin || ''))) throw new Error('Нужна ссылка на товар Walmart вида walmart.com/ip/…/<номер>');
    type = 'scrape_walmart'; url = `https://www.walmart.com/ip/${asin}`;

    // Fast path: ScraperAPI handles Walmart server-side (~3-5 sec), no Mac agent needed.
    if (scraperApiEnabled()) {
      const { rows: [job] } = await db.query(
        `INSERT INTO agent_jobs (workspace_id, type, payload, status, taken_at)
         VALUES ($1, $2, $3::jsonb, 'taken', NOW()) RETURNING id`,
        [ws, type, JSON.stringify({ url, product_id: productId, asin, via: 'scraperapi' })]);
      const jobId = job.id;
      await db.query(`UPDATE products SET scrape_job_id = $1, scrape_status = 'processing', scrape_error = NULL,
                       scrape_started_at = NOW() WHERE id = $2 AND workspace_id = $3`, [jobId, productId, ws]);
      scrapeWalmartViaScraperApi(asin)
        .then(async (data) => {
          await db.query(`UPDATE agent_jobs SET status = 'done', done_at = NOW(), result = $1::jsonb WHERE id = $2`,
            [JSON.stringify({ ok: true, data }), jobId]);
          await applyScrapeResult(ws, jobId, true, data, null);
        })
        .catch(async (e) => {
          console.warn(`[scraperapi] walmart/${asin} failed, falling back to Mac agent:`, e.message);
          await db.query(`UPDATE agent_jobs SET status = 'pending', taken_at = NULL, result = NULL WHERE id = $1`, [jobId]);
        });
      return jobId;
    }
  } else if (['target', 'bestbuy', 'etsy'].includes(source)) {
    const link = parseProductLink(sourceUrl);
    if (!link || link.source !== source || link.asin !== String(asin)) throw new Error('Invalid product URL for ' + source);
    type = 'scrape_' + source; url = link.url;
  } else {
    if (source !== 'amazon') throw new Error('Unsupported marketplace');
    if (!AMAZON_MARKETS.includes(marketplace)) throw new Error(`Неизвестный маркетплейс Amazon: ${marketplace}`);
    type = 'scrape_amazon'; url = amazonUrl(asin, marketplace);

    // Fast path: ScraperAPI handles Amazon server-side (~3-5 sec), no Mac agent needed.
    if (scraperApiEnabled()) {
      const { rows: [job] } = await db.query(
        `INSERT INTO agent_jobs (workspace_id, type, payload, status, taken_at)
         VALUES ($1, $2, $3::jsonb, 'taken', NOW()) RETURNING id`,
        [ws, type, JSON.stringify({ url, product_id: productId, asin, via: 'scraperapi' })]);
      const jobId = job.id;
      await db.query(`UPDATE products SET scrape_job_id = $1, scrape_status = 'processing', scrape_error = NULL,
                       scrape_started_at = NOW() WHERE id = $2 AND workspace_id = $3`, [jobId, productId, ws]);

      scrapeAmazonViaScraperApi(asin, marketplace)
        .then(async (data) => {
          await db.query(
            `UPDATE agent_jobs SET status = 'done', done_at = NOW(), result = $1::jsonb WHERE id = $2`,
            [JSON.stringify({ ok: true, data }), jobId]);
          await applyScrapeResult(ws, jobId, true, data, null);
        })
        .catch(async (e) => {
          console.warn(`[scraperapi] amazon/${asin} failed, falling back to Mac agent:`, e.message);
          await db.query(`UPDATE agent_jobs SET status = 'pending', taken_at = NULL, result = NULL WHERE id = $1`, [jobId]);
        });
      return jobId;
    }
  }
  const jobId = await enqueueAgentJob(ws, type, { url, product_id: productId, asin });
  await db.query(`UPDATE products SET scrape_job_id = $1, scrape_status = 'processing', scrape_error = NULL,
                   scrape_started_at = NOW() WHERE id = $2 AND workspace_id = $3`, [jobId, productId, ws]);
  return jobId;
}

async function fail(ws, productId, jobId, message) {
  await db.query(`UPDATE products SET scrape_status = 'failed', scrape_error = $1
                   WHERE id = $2 AND workspace_id = $3 AND scrape_job_id = $4 AND scrape_status = 'processing'`,
    [String(message || 'Неизвестная ошибка').slice(0, 500), productId, ws, jobId]);
}

async function saveReviews(productId, reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return;
  const { rows } = await db.query(
    'SELECT COUNT(*) AS c FROM product_reviews WHERE product_id = $1 AND scraped = true',
    [productId]);
  if (Number(rows[0]?.c) > 0) return;
  const { nanoid: _nanoid } = await import('nanoid');
  for (const rv of reviews.slice(0, 10)) {
    if (!rv.text) continue;
    await db.query(
      `INSERT INTO product_reviews (id, product_id, author, rating, text, images, scraped)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
       ON CONFLICT (id) DO NOTHING`,
      [`rev_${_nanoid(20)}`, productId, rv.author, rv.rating, rv.text, JSON.stringify(rv.images || [])]);
  }
}
// Applies one finished job to its product — only if the product still waits for exactly this job
// (a newer «Ещё раз» replaced it otherwise). Safe to call twice.
export async function applyScrapeResult(ws, jobId, ok, data, error) {
  const { rows: [p] } = await db.query(
    `SELECT id, source_id, marketplace, bundle_config FROM products WHERE workspace_id = $1 AND scrape_job_id = $2 AND scrape_status = 'processing'`,
    [ws, jobId]);
  if (!p) return;
  if (!ok) return fail(ws, p.id, jobId, error || 'Агент не смог открыть страницу Amazon');
  let d;
  try { d = await productFromAgentData(data, p.source_id); }
  catch (e) { return fail(ws, p.id, jobId, e.message); }
  const bundles = parseBundles(p.bundle_config);
  const { rowCount } = await db.query(`
    UPDATE products SET title = $1, description = $2, source_price = $3, images = $4::jsonb, rating = $5, reviews_count = $6,
           photo_reviews_count = $7, has_photo_reviews = $8, bundle_config = COALESCE($9::jsonb, bundle_config),
           scrape_status = 'done', scrape_error = NULL, updated_at = NOW(), source_currency = $13,
           preset_creatives_due_at = CASE WHEN creative_preset_id IS NOT NULL THEN NOW() ELSE NULL END,
           preset_creatives_lease_at = NULL, preset_creatives_attempts = 0, preset_creatives_error = NULL
     WHERE id = $10 AND workspace_id = $11 AND scrape_job_id = $12 AND scrape_status = 'processing'`,
    [d.title, d.description, d.price, JSON.stringify(d.images), d.rating, d.reviews_count,
     // null = unknown: Amazon shows the photo-review count only to signed-in visitors.
     d.photo_reviews_count ?? null, !!d.has_photo_reviews,
     bundles.length ? JSON.stringify(withRealOldPrice(bundles, d.price, d.currency || MARKET_CURRENCY[p.marketplace])) : null, p.id, ws, jobId, d.currency || MARKET_CURRENCY[p.marketplace] || null]);
  if (rowCount) { await runPresetCreatives(ws, p.id); saveReviews(p.id, data?.reviews).catch(() => {}); }
}

// Queues the scrape preset's creatives once. The «due» mark is set with scrape_status='done';
// a 5-minute lease keeps concurrent workers apart. The batch carries the internal key of this scrape
// event ('scrape:<job id>'): a replay after a crash between the insert and clearing the mark adds
// nothing (unique index + ON CONFLICT DO NOTHING, migration 024), manual generations are not confused with it.
export async function runPresetCreatives(ws, productId) {
  const { rows: [p] } = await db.query(`
    UPDATE products SET preset_creatives_lease_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND preset_creatives_due_at IS NOT NULL
       AND (preset_creatives_lease_at IS NULL OR preset_creatives_lease_at < NOW() - INTERVAL '5 minutes')
    RETURNING preset_creatives_due_at::text AS due, scrape_job_id`, [productId, ws]);
  if (!p) return;
  const clear = () => db.query(`UPDATE products SET preset_creatives_due_at = NULL, preset_creatives_lease_at = NULL, preset_creatives_error = NULL
                                 WHERE id = $1 AND preset_creatives_due_at = $2::timestamptz`, [productId, p.due]);
  // Stable per scrape event: the job id; rows marked before job ids existed fall back to the mark itself.
  const batchKey = p.scrape_job_id ? `scrape:${p.scrape_job_id}` : `scrape-due:${p.due}`;
  try {
    const { generateFromScrapePreset } = await import('../api/routes/creatives.js');
    await generateFromScrapePreset(productId, { batchKey });
  } catch (e) {
    // Keep the mark: release the lease, count the attempt, show why. After 3 failures stop retrying,
    // the reason stays visible on the product.
    const reason = String(e?.message || 'Не удалось поставить креативы по пресету').slice(0, 500);
    console.error('[scrape] creatives after scrape:', reason);
    await db.query(`
      UPDATE products SET preset_creatives_lease_at = NULL, preset_creatives_attempts = preset_creatives_attempts + 1,
             preset_creatives_error = $3,
             preset_creatives_due_at = CASE WHEN preset_creatives_attempts + 1 >= 3 THEN NULL ELSE preset_creatives_due_at END
       WHERE id = $1 AND preset_creatives_due_at = $2::timestamptz`, [productId, p.due, reason]);
    return;
  }
  await clear();
}

export async function recoverScrapes() {
  // 1) Finished jobs whose result was not applied (backend down or busy when it arrived).
  const { rows: done } = await db.query(`
    SELECT p.workspace_id, j.id AS job_id, j.status, j.result FROM products p
      JOIN agent_jobs j ON j.id = p.scrape_job_id AND j.workspace_id = p.workspace_id
     WHERE p.scrape_status = 'processing' AND j.status IN ('done', 'failed')`);
  for (const r of done) {
    await applyScrapeResult(r.workspace_id, r.job_id, r.status === 'done', r.result?.data, r.result?.error)
      .catch(e => console.error('[scrape] recover:', e.message));
  }
  // 1b) Scraped products whose preset creatives were not queued (crash right after «done»).
  const { rows: due } = await db.query(`
    SELECT id, workspace_id FROM products
     WHERE scrape_status = 'done' AND preset_creatives_due_at IS NOT NULL AND preset_creatives_due_at < NOW() - INTERVAL '1 minute'
       AND (preset_creatives_lease_at IS NULL OR preset_creatives_lease_at < NOW() - INTERVAL '5 minutes')
     LIMIT 50`);
  for (const r of due) await runPresetCreatives(r.workspace_id, r.id).catch(e => console.error('[scrape] preset creatives:', e.message));
  // 2) Waiting too long, or no job at all (scrapes started before this change, old FA rows): fail with a reason.
  // The stuck product's job is cancelled too if it still waits in the queue, so the agent doesn't run it for nothing.
  await db.query(`
    WITH stuck AS (
    UPDATE products p SET scrape_status = 'failed',
           scrape_error = CASE WHEN p.scrape_job_id IS NULL
             THEN 'Скрап прервался (перезапуск сервера или старый движок) — нажмите «Ещё раз»'
             ELSE 'Агент на Mac не вернул страницу за ${STUCK_MIN} мин — проверьте агента и AdsPower и нажмите «Ещё раз»' END
     WHERE p.scrape_status = 'processing'
       AND COALESCE(p.scrape_started_at, p.updated_at, p.created_at) < NOW() - INTERVAL '${STUCK_MIN} minutes'
       AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.id = p.scrape_job_id AND j.status IN ('done', 'failed'))
    RETURNING p.scrape_job_id)
    UPDATE agent_jobs SET status = 'failed', done_at = NOW(),
           result = '{"ok":false,"error":"Отменено: товар ждал дольше ${STUCK_MIN} мин","data":null}'::jsonb
     WHERE id IN (SELECT scrape_job_id FROM stuck WHERE scrape_job_id IS NOT NULL) AND status = 'pending'`);
}

export function startScrapeRecovery() {
  const run = () => recoverScrapes().catch(e => console.error('[scrape] recover:', e.message));
  setTimeout(run, 5000);
  setInterval(run, 2 * 60 * 1000).unref?.();
}
