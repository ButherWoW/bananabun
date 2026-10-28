// Walmart product scraping via ScraperAPI (server-side, no browser required).
// Set SCRAPER_API_KEY in .env to enable. Falls back to the Mac agent when absent.
//
// ScraperAPI's Walmart endpoint (?autoparse=true) returns structured JSON:
// product_name, price, price_currency, old_price, images[], rating, total_reviews,
// product_short_description, product_highlights, specifications, product_availability.

const SCRAPER_API_BASE = 'https://api.scraperapi.com';
// Each Walmart JS-rendered page costs ~10 credits with autoparse.
const TIMEOUT_MS = 30_000;

/**
 * Fetch Walmart product data for a given item ID via ScraperAPI.
 * Returns data in the Mac-agent format expected by productFromAgentData / applyScrapeResult.
 *
 * @param {string} itemId  Walmart item ID (numeric, e.g. "16863404913")
 * @returns {Promise<{title,price,rating,reviews_count,description,images:string[],currency:string}>}
 */
export async function scrapeWalmartViaScraperApi(itemId) {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error('SCRAPER_API_KEY not configured');

  const walmartUrl = `https://www.walmart.com/ip/${itemId}`;
  const apiUrl = `${SCRAPER_API_BASE}/?api_key=${key}&url=${encodeURIComponent(walmartUrl)}&autoparse=true`;

  let res;
  try {
    res = await fetch(apiUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`ScraperAPI network error: ${e.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ScraperAPI HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  let d;
  try { d = await res.json(); } catch (e) {
    throw new Error(`ScraperAPI invalid JSON: ${e.message}`);
  }

  const name = d.product_name || d.name;
  if (!name) throw new Error('ScraperAPI: товар не найден (нет product_name)');

  // availability check: warn but don't fail — product may be temporarily OOS
  if (d.product_availability && d.product_availability !== 'IN_STOCK') {
    console.warn(`[scraperapi] walmart/${itemId}: availability=${d.product_availability}`);
  }

  const price = typeof d.price === 'number' ? d.price
    : typeof d.price === 'string' ? parseFloat(d.price) : null;

  const rating = typeof d.rating === 'number' ? d.rating
    : typeof d.average_rating === 'number' ? Math.round(d.average_rating * 10) / 10
    : null;

  const reviews_count = typeof d.total_reviews === 'number' ? d.total_reviews : 0;

  // Description: short description first, then bullet highlights
  const highlights = Array.isArray(d.product_highlights)
    ? d.product_highlights.slice(0, 5).join('\n') : '';
  const description = d.product_short_description || highlights || '';

  // Images: array of CDN URLs from walmartimages.com
  const images = Array.isArray(d.images)
    ? d.images.filter(u => typeof u === 'string' && u.startsWith('https://'))
    : [];

  const currency = (typeof d.price_currency === 'string' && /^[A-Z]{3}$/.test(d.price_currency))
    ? d.price_currency : 'USD';

  return { title: name, price, rating, reviews_count, description, images, currency };
}

/** True when ScraperAPI is configured for this process. */
export const scraperApiEnabled = () => Boolean(process.env.SCRAPER_API_KEY);
