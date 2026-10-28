import { db } from '../db/client.js';
import { enqueueAgentJob } from '../api/routes/agent.js';
import { amazonUrl, withRealOldPrice } from './engine.js';
import { AMAZON_MARKETS, productFromAgentData } from './scraper.js';

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

export async function enqueueOwnScrape(ws, productId, asin, marketplace) {
  if (!AMAZON_MARKETS.includes(marketplace)) throw new Error(`Неизвестный маркетплейс Amazon: ${marketplace}`);
  const jobId = await enqueueAgentJob(ws, 'scrape_amazon', { url: amazonUrl(asin, marketplace), product_id: productId, asin });
  await db.query(`UPDATE products SET scrape_job_id = $1, scrape_status = 'processing', scrape_error = NULL,
                   scrape_started_at = NOW() WHERE id = $2 AND workspace_id = $3`, [jobId, productId, ws]);
  return jobId;
}

async function fail(ws, productId, jobId, message) {
  await db.query(`UPDATE products SET scrape_status = 'failed', scrape_error = $1
                   WHERE id = $2 AND workspace_id = $3 AND scrape_job_id = $4 AND scrape_status = 'processing'`,
    [String(message || 'Неизвестная ошибка').slice(0, 500), productId, ws, jobId]);
}

// Applies one finished job to its product — only if the product still waits for exactly this job
// (a newer «Ещё раз» replaced it otherwise). Safe to call twice.
export async function applyScrapeResult(ws, jobId, ok, data, error) {
  const { rows: [p] } = await db.query(
    `SELECT id, source_id, bundle_config FROM products WHERE workspace_id = $1 AND scrape_job_id = $2 AND scrape_status = 'processing'`,
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
           scrape_status = 'done', scrape_error = NULL, updated_at = NOW()
     WHERE id = $10 AND workspace_id = $11 AND scrape_job_id = $12 AND scrape_status = 'processing'`,
    [d.title, d.description, d.price, JSON.stringify(d.images), d.rating, d.reviews_count,
     // null = unknown: Amazon shows the photo-review count only to signed-in visitors.
     d.photo_reviews_count ?? null, !!d.has_photo_reviews,
     bundles.length ? JSON.stringify(withRealOldPrice(bundles, d.price)) : null, p.id, ws, jobId]);
  if (rowCount) {
    const { generateFromScrapePreset } = await import('../api/routes/creatives.js');
    await generateFromScrapePreset(p.id).catch(e => console.error('[scrape] creatives after scrape:', e.message));
  }
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
