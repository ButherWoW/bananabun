/** Own engine only. Legacy FA environment variables cannot change the mode. */
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
  const rules = {
    target: [/^(www\.)?target\.com$/, /^\/p\/.*\/A-(\d{5,15})\/?$/],
    bestbuy: [/^(www\.)?bestbuy\.com$/, /^\/(?:site\/(?:[^/]+\/)?|product\/[^/]+\/)([A-Za-z0-9]{5,20})(?:\.p)?\/?$/],
    etsy: [/^(www\.)?etsy\.com$/, /^\/(?:[a-z]{2}\/)?listing\/(\d{5,20})(?:\/[^/]+)?\/?$/],
  };
  for (const [source, [domain, path]] of Object.entries(rules)) {
    if (!domain.test(host)) continue;
    const id = u.pathname.match(path)?.[1];
    if (!id || u.username || u.password || u.port) return {source, url: clean};
    return {source, asin: id, marketplace: source === 'etsy' ? null : 'us', url: 'https://www.' + host + u.pathname};
  }
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
  if (pa.asin || pb.asin) return pa.source === pb.source && pa.asin === pb.asin;
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
