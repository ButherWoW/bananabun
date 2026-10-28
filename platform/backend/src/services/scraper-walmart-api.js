// Amazon and Walmart product scraping via ScraperAPI (server-side, no browser required).
// Set SCRAPER_API_KEY in .env to enable. Falls back to the Mac agent when absent.
//
// Walmart (?autoparse=true): product_name, price, price_currency, old_price, images[],
//   rating, total_reviews, product_short_description, product_highlights, specifications.
// Amazon (/structured/amazon/product): name, pricing, rating, reviews_count, images[],
//   description, features, product_information.

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

// ─── Amazon ────────────────────────────────────────────────────────────────

// Map our marketplace codes → ScraperAPI country codes for the structured endpoint.
const AMAZON_COUNTRY = {
  fr: 'fr', es: 'es', de: 'de', it: 'it',
  uk: 'gb',   // ScraperAPI uses 'gb' for amazon.co.uk
  com: 'us', nl: 'nl', pl: 'pl', be: 'be', se: 'se',
};

/**
 * Fetch Amazon product data via ScraperAPI's structured Amazon endpoint.
 * Returns data in the Mac-agent format expected by productFromAgentData / applyScrapeResult.
 *
 * @param {string} asin        Amazon ASIN
 * @param {string} marketplace Our marketplace code (fr, es, de, it, uk, com, nl, pl, be, se)
 * @returns {Promise<{title,price,rating,reviews_count,description,images:string[],currency:string}>}
 */
export async function scrapeAmazonViaScraperApi(asin, marketplace = 'com') {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error('SCRAPER_API_KEY not configured');

  const country = AMAZON_COUNTRY[marketplace];
  if (!country) throw new Error(`ScraperAPI: unknown marketplace ${marketplace}`);

  const apiUrl = `${SCRAPER_API_BASE}/structured/amazon/product?api_key=${key}&asin=${encodeURIComponent(asin)}&country=${country}`;

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

  const name = d.name;
  if (!name) throw new Error(`ScraperAPI: Amazon товар не найден (ASIN=${asin})`);

  // Price: ScraperAPI returns pricing as string like "$29.99" or object
  let price = null;
  if (typeof d.pricing === 'number') {
    price = d.pricing;
  } else if (typeof d.pricing === 'string') {
    const m = d.pricing.match(/[\d.,]+/);
    if (m) price = parseFloat(m[0].replace(',', '.'));
  } else if (d.price) {
    price = typeof d.price === 'number' ? d.price : parseFloat(String(d.price).replace(/[^0-9.]/g, ''));
  }

  const rating = typeof d.rating === 'number' ? d.rating
    : typeof d.rating === 'string' ? parseFloat(d.rating) : null;

  const reviews_count = typeof d.reviews_count === 'number' ? d.reviews_count
    : typeof d.reviews_count === 'string' ? parseInt(d.reviews_count.replace(/\D/g, '')) || 0 : 0;

  // Description: features list or description text
  const features = Array.isArray(d.features) ? d.features.slice(0, 6).join('\n') : '';
  const description = d.description || features || '';

  // Images: array of URLs (Amazon CDN)
  const images = Array.isArray(d.images)
    ? d.images.filter(u => typeof u === 'string' && u.startsWith('https://'))
    : [];

  // Currency by marketplace
  const CURRENCY = { fr: 'EUR', es: 'EUR', de: 'EUR', it: 'EUR', nl: 'EUR', be: 'EUR', uk: 'GBP', com: 'USD', pl: 'PLN', se: 'SEK' };
  const currency = CURRENCY[marketplace] || 'USD';

  return { title: name, price, rating, reviews_count, description, images, currency };
}

/** True when ScraperAPI is configured for this process. */
export const scraperApiEnabled = () => Boolean(process.env.SCRAPER_API_KEY);

// ─── Amazon Reviews ─────────────────────────────────────────────────────────

/**
 * Fetch up to `limit` customer reviews for an Amazon product via ScraperAPI.
 * Returns [{author, rating, text}] — only reviews that have text.
 */
export async function scrapeAmazonReviewsViaScraperApi(asin, marketplace = 'fr', limit = 10) {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error('SCRAPER_API_KEY not configured');
  const country = AMAZON_COUNTRY[marketplace] || 'fr';
  const apiUrl = `${SCRAPER_API_BASE}/structured/amazon/reviews?api_key=${key}&asin=${encodeURIComponent(asin)}&country=${country}`;
  let res;
  try { res = await fetch(apiUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (e) { throw new Error(`ScraperAPI reviews network error: ${e.message}`); }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ScraperAPI reviews HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  let d;
  try { d = await res.json(); } catch (e) { throw new Error(`ScraperAPI reviews invalid JSON: ${e.message}`); }
  return (Array.isArray(d.reviews) ? d.reviews : [])
    .slice(0, limit)
    .map(r => ({
      author: String(r.author || r.name || 'Client Amazon').slice(0, 100),
      rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))),
      text: String(r.text || r.body || r.content || '').trim(),
    }))
    .filter(r => r.text.length > 10);
}