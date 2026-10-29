// Amazon and Walmart product scraping via ScraperAPI (server-side, no browser required).
// Set SCRAPER_API_KEY in .env to enable. Falls back to the Mac agent when absent.
//
// Walmart (?autoparse=true): product_name, price, price_currency, old_price, images[],
//   rating, total_reviews, product_short_description, product_highlights, specifications.
// Amazon (/structured/amazon/product): name, pricing, rating, reviews_count, images[],
//   description, features, product_information.

const SCRAPER_API_BASE = 'https://api.scraperapi.com';
// Amazon/Walmart pages with JS rendering can take 30-60s on ScraperAPI.
const TIMEOUT_MS = 60_000;

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

  // Reviews from the same page (up to 5 from Walmart autoparse)
  const reviews = Array.isArray(d.reviews)
    ? d.reviews.slice(0, 10).map(r => ({
        author: String(r.author || r.reviewer_name || 'Client').slice(0, 100),
        rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))),
        text: String(r.text || r.body || '').trim(),
        images: [],
      })).filter(r => r.text.length > 5)
    : [];

  return { title: name, price, rating, reviews_count, description, images, currency, reviews };
}

// ─── Amazon ────────────────────────────────────────────────────────────────

// Amazon domain by marketplace code.
const AMAZON_DOMAIN = {
  fr: 'amazon.fr', es: 'amazon.es', de: 'amazon.de', it: 'amazon.it',
  uk: 'amazon.co.uk', com: 'amazon.com', nl: 'amazon.nl',
  pl: 'amazon.pl', be: 'amazon.com.be', se: 'amazon.se',
};

// Map our marketplace codes → ScraperAPI country codes for the reviews endpoint.
const AMAZON_COUNTRY = {
  fr: 'fr', es: 'es', de: 'de', it: 'it',
  uk: 'gb', com: 'us', nl: 'nl', pl: 'pl', be: 'be', se: 'se',
};

/**
 * Fetch Amazon product data via ScraperAPI autoparse (same plan as Walmart).
 * Returns data in the Mac-agent format expected by productFromAgentData / applyScrapeResult.
 *
 * @param {string} asin        Amazon ASIN
 * @param {string} marketplace Our marketplace code (fr, es, de, it, uk, com, nl, pl, be, se)
 * @returns {Promise<{title,price,rating,reviews_count,description,images:string[],currency:string}>}
 */
export async function scrapeAmazonViaScraperApi(asin, marketplace = 'com') {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error('SCRAPER_API_KEY not configured');

  const domain = AMAZON_DOMAIN[marketplace];
  if (!domain) throw new Error(`ScraperAPI: неизвестный маркетплейс ${marketplace}`);

  const amazonUrl = `https://www.${domain}/dp/${asin}`;
  const apiUrl = `${SCRAPER_API_BASE}/?api_key=${key}&url=${encodeURIComponent(amazonUrl)}&autoparse=true`;

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

  // autoparse fields: product_name (same as Walmart), price as number or string
  const name = d.product_name || d.name;
  if (!name) throw new Error(`ScraperAPI: Amazon товар не найден (ASIN=${asin}, ${domain})`);

  let price = null;
  const priceSrc = d.price ?? d.pricing ?? '';
  if (typeof priceSrc === 'number') {
    price = priceSrc;
  } else if (typeof priceSrc === 'string' && priceSrc) {
    const digits = priceSrc.replace(/[^0-9.,]/g, '');
    const last = digits.replace(/^.*[,.]/, '');
    if (last.length <= 2) {
      price = parseFloat(digits.replace(/[.,](?=\d{1,2}$)/, '__').replace(/[.,]/g, '').replace('__', '.'));
    } else {
      price = parseFloat(digits.replace(/[.,]/g, ''));
    }
    if (isNaN(price)) price = null;
  }

  const rating = typeof d.average_rating === 'number' ? Math.round(d.average_rating * 10) / 10
    : typeof d.average_rating === 'string' ? parseFloat(d.average_rating) : null;

  const reviews_count = typeof d.total_reviews === 'number' ? d.total_reviews
    : typeof d.total_reviews === 'string' ? parseInt(String(d.total_reviews).replace(/\D/g, '')) || 0 : 0;

  // autoparse description: product_short_description or highlights (same fields as Walmart)
  const description = d.product_short_description
    || (Array.isArray(d.product_highlights) ? d.product_highlights.slice(0, 6).join('\n') : '')
    || '';

  // autoparse images field (not highResImages which is structured-endpoint only)
  const images = (Array.isArray(d.images) ? d.images : [])
    .filter(u => typeof u === 'string' && u.startsWith('https://'));

  if (!price && !images.length) throw new Error(`ScraperAPI: Amazon вернул неполные данные — нет цены и фото (ASIN=${asin}). Возможно, autoparse не поддерживает этот регион.`);

  const CURRENCY = { fr: 'EUR', es: 'EUR', de: 'EUR', it: 'EUR', nl: 'EUR', be: 'EUR', uk: 'GBP', com: 'USD', pl: 'PLN', se: 'SEK' };
  const currency = CURRENCY[marketplace] || 'USD';

  // Reviews from the same page (autoparse includes up to ~13 reviews)
  const reviews = Array.isArray(d.reviews)
    ? d.reviews.slice(0, 10).map(r => ({
        author: String(r.username || r.author || 'Client Amazon').slice(0, 100),
        rating: Math.min(5, Math.max(1, Math.round(Number(r.stars || r.rating) || 5))),
        text: String(r.review || r.text || r.body || '').trim(),
        images: Array.isArray(r.images) ? r.images.filter(u => typeof u === 'string' && u.startsWith('https://')) : [],
      })).filter(r => r.text.length > 5)
    : [];

  return { title: name, price, rating, reviews_count, description, images, currency, reviews };
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
    .map(r => ({ author: String(r.author || r.name || 'Client Amazon').slice(0, 100), rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))), text: String(r.text || r.body || r.content || '').trim(), images: Array.isArray(r.images) ? r.images.filter(u => typeof u === 'string' && u.startsWith('https://')) : [], }))
    .filter(r => r.text.length > 10);
}