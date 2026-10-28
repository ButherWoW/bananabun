import { db } from '../db/client.js';
import { faAvailable } from '../services/fa-client.js';
import { faReadProduct, withRealOldPrice } from '../services/engine.js';
import { generateFromScrapePreset } from '../api/routes/creatives.js';

const TICK_MS = 15_000;
const TIMEOUT_MIN = 15;

function parseBundles(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function tick() {
  const { rows } = await db.query(
    `SELECT id, external_id, bundle_config, scrape_started_at FROM products
     WHERE engine = 'fa' AND scrape_status = 'processing'
     ORDER BY scrape_started_at NULLS FIRST LIMIT 20`
  );
  for (const p of rows) {
    const ageMin = p.scrape_started_at ? (Date.now() - new Date(p.scrape_started_at)) / 60000 : 0;
    if (!p.external_id) {
      if (ageMin > 2) await db.update('products', p.id, { scrape_status: 'failed', scrape_error: 'FA не принял скрап' });
      continue;
    }
    try {
      const { state, update } = await faReadProduct(p.external_id);
      if (state === 'done') {
        const bundles = parseBundles(p.bundle_config);
        await db.update('products', p.id, {
          ...update,
          ...(bundles.length ? { bundle_config: JSON.stringify(withRealOldPrice(bundles, update.source_price)) } : {}),
          scrape_status: 'done',
          scrape_error: null,
        });
        await generateFromScrapePreset(p.id).catch(e => console.error('[product-sync] preset creatives', p.id, e.message));
      } else if (state === 'failed') {
        await db.update('products', p.id, { ...update, scrape_status: 'failed' });
      } else if (ageMin > TIMEOUT_MIN) {
        await db.update('products', p.id, { scrape_status: 'failed', scrape_error: `FA не закончил скрап за ${TIMEOUT_MIN} минут` });
      }
    } catch (err) {
      console.error('[product-sync]', p.id, err.message);
      if (ageMin > TIMEOUT_MIN) {
        await db.update('products', p.id, { scrape_status: 'failed', scrape_error: String(err.message).slice(0, 500) });
      }
    }
  }
}

export function startProductSync() {
  if (!faAvailable()) return;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (err) { console.error('[product-sync] tick', err.message); }
    finally { running = false; }
  }, TICK_MS);
}
