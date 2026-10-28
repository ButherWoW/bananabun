/** Own engine only. Legacy FA environment variables cannot change the mode. */
import { faAvailable, faScrapeProducts, faGetProduct, faImagesAvailable, faDownloadImage } from './fa-client.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const IMAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads', 'images');

export function currentEngine() {
  return 'own';
}

const AMAZON_TLDS = { fr: 'fr', es: 'es', de: 'de', it: 'it', 'co.uk': 'uk', com: 'com', nl: 'nl', pl: 'pl', 'com.be': 'be', se: 'se' };

/** Parse a product link or bare ASIN → { source, url, asin?, marketplace? } or null. */
export function parseProductLink(input, fallbackMarketplace = 'fr') {
  const s = String(input || '').trim();
  if (/^[A-Z0-9]{10}$/i.test(s)) {
    const asin = s.toUpperCase();
    return { source: 'amazon', asin, marketplace: fallbackMarketplace, url: amazonUrl(asin, fallbackMarketplace) };
  }
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  const tld = host.match(/^amazon\.(.+)$/)?.[1];
  if (tld) {
    const marketplace = AMAZON_TLDS[tld];
    const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase();
    if (!marketplace || !asin) return null;
    return { source: 'amazon', asin, marketplace, url: amazonUrl(asin, marketplace) };
  }
  const clean = `${u.origin}${u.pathname}`;
  if (/(^|\.)walmart\.com$/.test(host)) {
    // walmart.com/ip/<slug>/<item id> or /ip/<item id>; the item id is the product's source id.
    const item = u.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,15})\/?$/)?.[1];
    if (!item) return { source: 'walmart', url: clean };
    return { source: 'walmart', asin: item, marketplace: 'us', url: `https://www.walmart.com/ip/${item}` };
  }
  if (/(^|\.)target\.com$/.test(host)) return { source: 'target', url: clean };
  if (/(^|\.)bestbuy\.com$/.test(host)) return { source: 'bestbuy', url: clean };
  if (/(^|\.)etsy\.com$/.test(host)) return { source: 'etsy', url: clean };
  return null;
}

export function amazonUrl(asin, marketplace) {
  const tld = Object.entries(AMAZON_TLDS).find(([, m]) => m === marketplace)?.[0] || 'fr';
  return `https://www.amazon.${tld}/dp/${asin}`;
}

/** Same product link? Amazon compares by ASIN, others by URL without query. */
export function sameProduct(a, b) {
  const pa = parseProductLink(a), pb = parseProductLink(b);
  if (!pa || !pb) return false;
  if (pa.asin || pb.asin) return pa.asin === pb.asin;
  return pa.url.replace(/\/$/, '') === pb.url.replace(/\/$/, '');
}

/**
 * Old price from the real marketplace price, the way FA does it:
 * qty "1" → price, "2+1" → price × 2 (paid units), "3" → price × 3. Always recomputed from the real
 * Amazon price: a value typed into a preset (e.g. 199.99) must never survive onto a product.
 */
export function withRealOldPrice(bundles, marketPrice, marketCurrency) {
  const price = Number(marketPrice);
  if (!Array.isArray(bundles) || !price) return bundles;
  return bundles.map(b => {
    // A price in another currency is not this bundle's old price: never convert, leave it empty.
    if (marketCurrency && b.currency && String(b.currency).toUpperCase() !== String(marketCurrency).toUpperCase()) {
      return { ...b, old_price: '' };
    }
    const paid = parseInt(String(b.qty).split('+')[0], 10);
    return paid > 0 ? { ...b, old_price: (price * paid).toFixed(2) } : b;
  });
}

// The shop's currency, for the old-price rule above.
export const MARKET_CURRENCY = { fr: 'EUR', es: 'EUR', de: 'EUR', it: 'EUR', nl: 'EUR', be: 'EUR', uk: 'GBP', com: 'USD', pl: 'PLN', se: 'SEK', us: 'USD' };

/* ───── FA engine ───── */

/** Starts FA scrapes for our placeholder products and returns [{ productId, externalId }]. */
export async function faStartScrapes(products) {
  const { ids } = await faScrapeProducts(products.map(p => p.source_url));
  if (ids.length === products.length) {
    return products.map((p, i) => ({ productId: p.id, externalId: ids[i] }));
  }
  // Counts differ: match each FA product to ours by its source link.
  const pairs = [];
  for (const extId of ids) {
    const fa = await faGetProduct(extId).catch(() => null);
    const ours = fa && products.find(p => !pairs.some(x => x.productId === p.id) && sameProduct(p.source_url, fa.source_url));
    if (ours) pairs.push({ productId: ours.id, externalId: extId });
  }
  return pairs;
}

async function downloadFaImages(paths) {
  if (!faImagesAvailable() || !paths?.length) return [];
  await mkdir(IMAGES_DIR, { recursive: true });
  const out = [];
  for (const p of paths.slice(0, 10)) {
    try {
      const name = `fa_${nanoid(12)}.jpg`;
      await writeFile(join(IMAGES_DIR, name), await faDownloadImage(p));
      out.push(`/uploads/images/${name}`);
    } catch { /* skip one bad image */ }
  }
  return out;
}

/**
 * Reads an FA product and maps it to our columns.
 * Returns { state: 'processing' | 'done' | 'failed', update }.
 */
export async function faReadProduct(externalId) {
  const fa = await faGetProduct(externalId);
  if (fa.parse_error) return { state: 'failed', update: { scrape_error: String(fa.parse_error).slice(0, 500) } };
  // FA shows a "скрапим" card with no title until parsing finishes.
  const finished = !!fa.title && (fa.progress >= 100 || (fa.gallery?.length || fa.photos || 0) > 0);
  if (!finished) return { state: 'processing', update: {} };

  const gallery = Array.isArray(fa.gallery) ? fa.gallery : [];
  const images = await downloadFaImages(gallery);
  return {
    state: 'done',
    update: {
      title: fa.title,
      description: fa.description || null,
      source_price: fa.source_price ? Number(fa.source_price) : null,
      reviews_count: fa.reviews_count || 0,
      photo_reviews_count: fa.photo_reviews_count || 0,
      external_images: JSON.stringify(gallery),
      specs: JSON.stringify(Array.isArray(fa.specs) ? fa.specs.filter(x => x?.label && x?.value) : []),
      ...(images.length ? { images: JSON.stringify(images) } : {}),
    },
  };
}
