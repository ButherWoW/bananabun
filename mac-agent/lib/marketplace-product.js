// Pure browser-side reader. Serialized into the existing AdsPower tab; no network calls.
export function readMarketplaceProduct(source, expectedId) {
  const patterns = {
    target: [/^(www\.)?target\.com$/, /\/p\/.*\/A-(\d+)(?:\/|$)/],
    bestbuy: [/^(www\.)?bestbuy\.com$/, /\/(?:site\/(?:[^/]+\/)?|product\/[^/]+\/)([A-Za-z0-9]{5,20})(?:\.p)?\/?$/],
    etsy: [/^(www\.)?etsy\.com$/, /\/(?:[a-z]{2}\/)?listing\/(\d+)(?:\/|$)/],
  };
  const identity = value => {
    try { const u = new URL(value, location.href); const p = patterns[source];
      return u.protocol === 'https:' && p?.[0].test(u.hostname) ? u.pathname.match(p[1])?.[1] : null;
    } catch { return null; }
  };
  if (identity(location.href) !== expectedId) return { error: 'PRODUCT_REDIRECT' };
  const heading = document.querySelector('h1')?.textContent || '';
  if (document.querySelector('#px-captcha, iframe[src*="captcha"], #captcha, #challenge-running') ||
      /access.*denied|verify (?:you are|your identity)|robot or human|are you a robot|security check|captcha/i.test(document.title + ' ' + heading)) return { error: 'ROBOT_CHECK' };
  const products = [], seen = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if ([].concat(node['@type'] || []).some(t => /(?:^|\/)Product$/.test(t))) products.push(node);
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) walk(node[key]);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent)); } catch { /* malformed blocks are not product facts */ }
  }
  // Target may add its product facts only after hydration. Read the product price
  // element, never arbitrary dollar amounts from recommendations or payment plans.
  if (!products.length && ['target', 'bestbuy'].includes(source)) {
    const selectors = source === 'target' ? '[data-test="product-price"]' :
      '[data-testid="customer-price"], [data-testid="price-block-customer-price"], [data-test-id="customer-price"], .priceView-customer-price span[aria-hidden="true"]';
    const priceText = document.querySelector(selectors)?.textContent?.trim() || '';
    const exact = priceText.match(/^(?:US)?\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)$/);
    const title = document.querySelector('h1')?.textContent?.trim();
    if (title && exact) {
      products.push({name: title, url: location.href,
        offers: {price: exact[1].replace(/,/g, ''), priceCurrency: 'USD'},
        image: document.querySelector('meta[property="og:image"]')?.content,
        description: document.querySelector('meta[name="description"]')?.content,
      });
    }
  }
  const matching = products.filter(p => [p.url, p['@id'], ...[].concat(p.offers || []).map(o => o?.url)].some(u => u && identity(u) === expectedId));
  const candidates = matching.length ? matching : products.filter(p => !p.url && !p['@id']);
  if (candidates.length !== 1) return { error: candidates.length ? 'AMBIGUOUS_PRODUCT' : 'NO_PRODUCT_DATA' };
  const product = candidates[0];
  const number = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    return Number(value);
  };
  let offers = [].concat(product.offers || []).flatMap(o => o?.offers ? [].concat(o.offers) : [o]).filter(Boolean);
  const choices = offers.map(o => ({
    price: number(o.price ?? o.priceSpecification?.price ?? (o.lowPrice === o.highPrice ? o.lowPrice : null)),
    currency: o.priceCurrency || o.priceSpecification?.priceCurrency,
    availability: o.availability,
  }));
  if (choices.length > 1 && choices.some(o => o.price !== choices[0].price || o.currency !== choices[0].currency || o.availability !== choices[0].availability)) return { error: 'VARIANT_REQUIRED' };
  const offer = choices[0];
  if (offer?.price == null) return { error: offers.some(o => o.lowPrice != null || o.highPrice != null) ? 'VARIANT_REQUIRED' : 'NO_PRICE' };
  if (!/^[A-Z]{3}$/.test(offer.currency || '')) return { error: 'NO_CURRENCY' };
  const imageHost = {target: /(^|\.)target\.scene7\.com$/, bestbuy: /(^|\.)bbystatic\.com$/, etsy: /(^|\.)etsystatic\.com$/}[source];
  const images = [...new Set([].concat(product.image || []).map(i => typeof i === 'string' ? i : i?.url || i?.contentUrl).filter(value => {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && imageHost.test(u.hostname); } catch { return false; }
  }))].slice(0, 12);
  const plain = value => { const el = document.createElement('template'); el.innerHTML = String(value || ''); return el.content.textContent.trim(); };
  const title = plain(product.name);
  if (!title) return { error: 'NO_TITLE' };
  const rating = number(product.aggregateRating?.ratingValue);
  const reviews = number(product.aggregateRating?.reviewCount ?? product.aggregateRating?.ratingCount);
  const stock = String(offer.availability || '').split('/').pop();
  return {
    title, price: offer.price, currency: offer.currency, images,
    description: plain(product.description) || null,
    rating: rating != null && rating <= 5 ? rating : null,
    reviews_count: Number.isInteger(reviews) ? reviews : null,
    available: stock === 'InStock' ? true : ['OutOfStock', 'SoldOut', 'Discontinued'].includes(stock) ? false : null,
    market_old_price: null, has_photo_reviews: false, photo_reviews_count: null,
  };
}
