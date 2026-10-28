import { connect } from './cdp.js';
import { sleep } from './common.js';
import { scrapeProfilePort } from './amazon.js';

// Walmart product pages in the same scrape profile as Amazon, opened like a person would.
// A robot check (PerimeterX «Press & Hold», «Robot or human?») is never solved or bypassed:
// the job stops with the reason and a human decides.
const WALMART = /^https:\/\/www\.walmart\.com\/ip\/(?:[^/?#]+\/)?(\d{5,15})(?:[/?#]|$)/;

const ROBOT_CHECK = `!!document.querySelector('#px-captcha, [id^="px-captcha"], iframe[src*="px-cloud"]')
  || /robot or human|are you a robot|verify your identity|access denied/i.test(document.title + ' ' + (document.querySelector('h1')?.textContent || ''))`;

// Everything comes from the page's own data: the schema.org Product markup Walmart publishes
// (application/ld+json), then the older __NEXT_DATA__ block, then the price element. Nothing is
// computed or filled in; a field the page doesn't give stays empty.
const PRODUCT = `(() => {
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const text = (html) => { const t = document.createElement('div'); t.innerHTML = String(html || ''); return t.textContent.replace(/\\s+\\n/g, '\\n').trim(); };
  // schema.org Product (may sit in an array or an @graph)
  let ld = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let j; try { j = JSON.parse(s.textContent); } catch { continue; }
    const items = [].concat(j?.['@graph'] || j || []);
    ld = items.find(x => [].concat(x?.['@type'] || []).includes('Product')) || ld;
    if (ld) break;
  }
  let next = null;
  try { next = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || 'null'); } catch {}
  const d = next?.props?.pageProps?.initialData?.data || {};
  const p = d.product || {};
  const offer = [].concat(ld?.offers || [])[0] || {};
  const price = num(offer.price) ?? (typeof p.priceInfo?.currentPrice?.price === 'number' ? p.priceInfo.currentPrice.price : null)
    ?? num(document.querySelector('[itemprop="price"]')?.getAttribute('content'));
  const currency = offer.priceCurrency || p.priceInfo?.currentPrice?.currencyUnit
    || document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || 'USD';
  const was = typeof p.priceInfo?.wasPrice?.price === 'number' ? p.priceInfo.wasPrice.price : null;
  const ldImages = [].concat(ld?.image || []).map(i => typeof i === 'string' ? i : i?.url || i?.contentUrl);
  const galleryImages = [...document.querySelectorAll('[data-testid="media-thumbnail"] img, [data-testid="hero-image-container"] img, [data-testid="vertical-carousel-container"] img')]
    .map(i => i.getAttribute('src') || '').map(u => u.split('?')[0]);
  const nextImages = (p.imageInfo?.allImages || []).map(i => i?.url);
  const images = [...new Set([...ldImages, ...nextImages, ...galleryImages].filter(u => /^https:\\/\\/[^/]*walmartimages\\.com\\//.test(u || '')))];
  const rating = num(ld?.aggregateRating?.ratingValue) ?? (typeof p.averageRating === 'number' ? p.averageRating : null);
  const reviews = Number(ld?.aggregateRating?.reviewCount ?? ld?.aggregateRating?.ratingCount ?? p.numberOfReviews) || 0;
  const availability = String(offer.availability || p.availabilityStatus || '');
  return {
    title: ld?.name || p.name || document.querySelector('h1')?.textContent?.trim() || null,
    price,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    market_old_price: was && price && was > price ? was : null,
    rating: rating && rating <= 5 ? rating : null,
    reviews_count: reviews,
    images: images.slice(0, 12),
    description: text(ld?.description || d.idml?.longDescription || p.shortDescription || '') || null,
    available: availability ? /InStock|IN_STOCK/.test(availability) : null,
    item_id: String(ld?.sku || p.usItemId || ''),
    has_photo_reviews: false,
    photo_reviews_count: null,
    // Page facts for a clear error when there is no price (no personal data).
    diag: {
      href: location.href.slice(0, 120),
      next: !!next, ld: !!ld, product_keys: Object.keys(p).slice(0, 30).join(","),
      price_info: JSON.stringify(p.priceInfo || null).slice(0, 300),
      dom_price: (document.querySelector('[itemprop="price"]')?.getAttribute('content') || document.querySelector('[data-seo-id="hero-price"], [data-testid="price-wrap"]')?.textContent || '').trim().slice(0, 60),
      notice: (document.querySelector('[data-testid="sticky-header-banner"], [data-testid="ip-unavailable"], .f6.dark-gray')?.textContent || '').trim().slice(0, 160),
    },
  };
})()`;

const evalValue = async (cdp, expression) =>
  (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

export async function scrapeWalmart(url) {
  if (!WALMART.test(url)) throw new Error('Скрап только страниц товаров Walmart (walmart.com/ip/…)');
  const port = await scrapeProfilePort();
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    const ready = `location.href !== 'about:blank' && (!!document.querySelector('script[type="application/ld+json"], #__NEXT_DATA__, [itemprop="price"]') || (${ROBOT_CHECK}))`;
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) {
      ok = (await cdp.send('Runtime.evaluate', { expression: ready, returnByValue: true }).catch(() => null))?.result?.value === true;
      if (!ok) await sleep(500);
    }
    if (!ok) throw new Error('Страница Walmart не загрузилась за 60 с в профиле скрапа (проверьте прокси профиля)');
    // The markup appears before the product is rendered: re-read until name and price are there (≤ 20 s).
    let data = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (await evalValue(cdp, ROBOT_CHECK)) {
        throw new Error('Walmart показал проверку на робота. Откройте страницу в профиле скрапа и пройдите её вручную, затем повторите скрап');
      }
      data = await evalValue(cdp, PRODUCT).catch(() => null);
      if (data?.title && data.price != null) break;
    }
    if (!data?.title) {
      throw Object.assign(new Error('На странице Walmart не найден товар — проверьте ссылку'), { data: { diag: data?.diag } });
    }
    if (data.price == null) {
      throw Object.assign(new Error('Walmart не показал цену товара (нет в наличии или недоступен для доставки)'), { data: { diag: data.diag } });
    }
    delete data.diag;
    return data;
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}
