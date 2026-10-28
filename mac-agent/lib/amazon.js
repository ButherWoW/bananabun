import path from 'node:path';
import fs from 'node:fs';
import { api } from './adspower.js';
import { connect } from './cdp.js';
import { ROOT, sleep } from './common.js';

// Product pages are opened in a normal AdsPower profile, like a person would.
// A robot check is never solved or bypassed: the job stops and asks for a human.
const PROFILE_FILE = path.join(ROOT, '.scrape_profile'); // serial number of the profile to use

const AMAZON = /^https:\/\/www\.amazon\.(fr|es|de|it|co\.uk|com|nl|pl|com\.be|se)\/(dp|product-reviews)\/[A-Z0-9]{10}(\/|\?|$)/;

// Only the profile named in ~/scripts/.scrape_profile — never someone else's open profile.
export async function scrapeProfilePort() {
  if (!fs.existsSync(PROFILE_FILE)) {
    throw new Error('Не выбран профиль AdsPower для скрапа: запишите его номер в ~/scripts/.scrape_profile');
  }
  const serial = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
  let info = await api('GET', `/api/v1/browser/active?serial_number=${encodeURIComponent(serial)}`);
  if (info.status !== 'Active') info = await api('GET', `/api/v1/browser/start?serial_number=${encodeURIComponent(serial)}&open_tabs=1`);
  if (!info.debug_port) throw new Error('AdsPower не отдал порт отладки профиля');
  return info.debug_port;
}

// Amazon shows the shop in the browser's language (profile #7 is English); the landing needs the country's.
const SHOP_LANG = { fr: 'fr_FR', es: 'es_ES', de: 'de_DE', it: 'it_IT', nl: 'nl_NL', pl: 'pl_PL', se: 'sv_SE', 'com.be': 'fr_BE' };
function inShopLanguage(url) {
  const u = new URL(url);
  const lang = SHOP_LANG[u.hostname.replace(/^www\.amazon\./, '')];
  if (lang) u.searchParams.set('language', lang);
  return u.toString();
}

async function withTab(port, url, fn) {
  url = inShopLanguage(url);
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  let restoreLang = null;
  try {
    // Amazon keeps the display language in a cookie (lc-acb<shop>): the country's language is set
    // for the time of this page only and the profile's own value is put back in `finally`.
    const lang = new URL(url).searchParams.get('language');
    if (lang) {
      const host = new URL(url).hostname;
      const name = `lc-acb${host.replace(/^www\.amazon\./, '').replace(/\./g, '')}`;
      const { cookies = [] } = await cdp.send('Network.getCookies', { urls: [`https://${host}/`] }).catch(() => ({}));
      const own = cookies.find((c) => c.name === name);
      if (!own || own.value !== lang) {
        restoreLang = own
          ? { name, value: own.value, domain: own.domain, path: own.path, expires: own.expires > 0 ? own.expires : undefined, secure: own.secure }
          : { name, delete: true, domain: `.${host.replace(/^www\./, '')}` };
        await cdp.send('Network.setCookie', { name, value: lang, domain: `.${host.replace(/^www\./, '')}`, path: '/', secure: true }).catch(() => {});
      }
      await cdp.send('Page.navigate', { url }).catch(() => {});
    }
    // Ready when the product (or a robot check) is on the page; Amazon pages keep loading for long.
    // Not the blank tab it starts as: Amazon's own page, with the product, results or a robot check.
    const ready = `location.href !== 'about:blank' && (!!document.querySelector('#productTitle, [data-hook="cr-filter-info-review-rating-count"], [data-component-type="s-search-result"], form[action*="validateCaptcha"]')
      || (document.readyState === 'complete' && !!document.title && /amazon/i.test(location.host)))`;
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: ready, returnByValue: true }).catch(() => null);
      ok = r?.result?.value === true;
      if (!ok) await sleep(500);
    }
    if (!ok) throw new Error('Страница Amazon не загрузилась за 60 с в профиле скрапа (проверьте прокси профиля)');
    // Amazon keeps rendering (and may reload for the language): wait until the page stops changing.
    const shape = `JSON.stringify([location.href, document.readyState, document.querySelectorAll('[data-component-type="s-search-result"]').length, document.title])`;
    let prev = '';
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const r = await cdp.send('Runtime.evaluate', { expression: shape, returnByValue: true }).catch(() => null);
      const cur = r?.result?.value || '';
      if (cur && cur === prev && cur.includes('"complete"')) break;
      prev = cur;
    }
    return await fn(cdp);
  } finally {
    if (restoreLang) {
      await (restoreLang.delete
        ? cdp.send('Network.deleteCookies', { name: restoreLang.name, domain: restoreLang.domain })
        : cdp.send('Network.setCookie', restoreLang)).catch(() => {});
    }
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}

const evalValue = async (cdp, expression) =>
  (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

const ROBOT_CHECK = `!!document.querySelector('form[action*="validateCaptcha"]') || /Robot Check|CAPTCHA|robot/i.test(document.title)`;

const PRODUCT = `(() => {
  const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
  const title = getText('#productTitle') || getText('h1.a-size-large');
  let price = null;
  const priceEl = document.querySelector('#corePrice_feature_div .a-price .a-offscreen') || document.querySelector('.a-price .a-offscreen')
    || document.querySelector('#priceblock_ourprice') || document.querySelector('#priceblock_dealprice');
  if (priceEl) {
    const raw = priceEl.textContent.replace(/[^\\d,.]/g, '');
    const dec = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
    const tail = raw.length - raw.lastIndexOf(dec) - 1;
    const num = tail === 3 ? raw.replace(/[,.]/g, '') : raw.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
    price = parseFloat(num);
  }
  let rating = null;
  const ratingEl = document.querySelector('[data-hook="rating-out-of-text"]') || document.querySelector('#acrPopover .a-icon-alt');
  const rm = ratingEl?.textContent.match(/(\\d[,.]?\\d?)/);
  if (rm) rating = parseFloat(rm[1].replace(',', '.'));
  let reviews_count = 0;
  const rc = (document.querySelector('#acrCustomerReviewText') || document.querySelector('[data-hook="total-review-count"]'))?.textContent.replace(/\\s/g, '').match(/[\\d.,]+/);
  if (rc) reviews_count = parseInt(rc[0].replace(/[.,]/g, ''), 10);
  const images = [];
  const main = document.querySelector('#landingImage') || document.querySelector('#imgBlkFront');
  if (main) {
    let dyn = null;
    try { dyn = Object.keys(JSON.parse(main.getAttribute('data-a-dynamic-image') || '{}'))[0]; } catch {}
    const src = main.getAttribute('data-old-hires') || dyn || main.src;
    if (src) images.push(src);
  }
  document.querySelectorAll('#altImages .a-button-thumbnail img').forEach(img => {
    const src = img.getAttribute('data-old-hires') || img.src;
    if (src && !src.includes('placeholder') && !/play-button|sprite/.test(src)) {
      const hi = src.replace(/\\._[^.]*_\\./, '.');
      if (!images.includes(hi)) images.push(hi);
    }
  });
  const bullets = [...document.querySelectorAll('#feature-bullets li span.a-list-item')].map(e => e.textContent.trim()).filter(Boolean);
  const description = getText('#productDescription') || bullets.join('\\n') || null;
  // «Reviews with images» carousel on the product page: photo reviews exist (their number needs sign-in).
  const has_photo_reviews = !!document.querySelector('#cm_cr_carousel_images_section, [data-hook="cr-media-gallery"], #cr-media-carousel');
  return { title, price, rating, reviews_count, images: images.filter(u => /^https:\\/\\//.test(u)).slice(0, 12), description, bullets, has_photo_reviews };
})()`;

const PHOTO_REVIEWS = `(() => {
  const t = document.querySelector('[data-hook="cr-filter-info-review-rating-count"]')?.textContent || '';
  const m = t.replace(/\\s/g, '').match(/([\\d.,]+)/g);
  return m ? parseInt(m[m.length - 1].replace(/[.,]/g, ''), 10) : 0;
})()`;

export async function scrapeAmazon(url) {
  if (!AMAZON.test(url)) throw new Error('Скрап только страниц товаров Amazon (/dp/ASIN)');
  const port = await scrapeProfilePort();
  const data = await withTab(port, url, async (cdp) => {
    if (await evalValue(cdp, ROBOT_CHECK)) {
      throw new Error('Amazon показал проверку на робота. Откройте страницу в профиле и пройдите её вручную, затем повторите скрап');
    }
    return evalValue(cdp, PRODUCT);
  });
  if (!data?.title) throw new Error('На странице Amazon не найден товар — проверьте ссылку');

  const asin = url.match(/\/dp\/([A-Z0-9]{10})/)[1];
  const reviewsUrl = url.replace(/\/dp\/[A-Z0-9]{10}.*$/, `/product-reviews/${asin}?mediaType=media_reviews_only`);
  // The photo-review filter is behind Amazon sign-in; we never sign in, so then the count is unknown (null),
  // not zero — the product page's own top reviews still tell whether photo reviews exist.
  data.photo_reviews_count = await withTab(port, reviewsUrl, async (cdp) => {
    if (await evalValue(cdp, ROBOT_CHECK)) return null;
    if (await evalValue(cdp, `location.pathname.startsWith('/ap/signin')`)) return null;
    return evalValue(cdp, PHOTO_REVIEWS);
  }).catch(() => null);
  if (data.photo_reviews_count > 0) data.has_photo_reviews = true;
  return data;
}

// Search results page (/s?k=…) in the same scrape profile; a robot check stops the job.
const SEARCH = /^https:\/\/www\.amazon\.(fr|es|de|it|co\.uk|com|nl|pl|com\.be|se)\/s\?k=[^#]{1,300}$/;

const SEARCH_RESULTS = `(() => {
  const num = (t) => { const raw = (t || '').replace(/[^\\d,.]/g, ''); if (!raw) return null;
    const dec = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.'; const tail = raw.length - raw.lastIndexOf(dec) - 1;
    const n = tail === 3 ? raw.replace(/[,.]/g, '') : raw.split(dec === ',' ? '.' : ',').join('').replace(dec, '.'); return parseFloat(n) || null; };
  return [...document.querySelectorAll('[data-component-type="s-search-result"]')].slice(0, 24).map((card) => {
    const asin = card.getAttribute('data-asin'); if (!asin) return null;
    const title = (card.querySelector('h2 span') || card.querySelector('h2'))?.textContent?.trim() || null;
    const price = num(card.querySelector('.a-price .a-offscreen')?.textContent);
    const rm = card.querySelector('.a-icon-alt')?.textContent?.match(/(\\d[,.]?\\d?)/);
    const rating = rm ? parseFloat(rm[1].replace(',', '.')) : null;
    const rc = (card.querySelector('[aria-label][href*="customerReviews"]') || card.querySelector('.a-size-base.s-underline-text'))?.textContent || '';
    const reviews_count = parseInt(rc.replace(/[^\\d]/g, ''), 10) || 0;
    const image = card.querySelector('img.s-image')?.src || null;
    const sponsored = !!card.querySelector('.puis-sponsored-label-text, [data-component-type="sp-sponsored-result"]');
    return { asin, title, price, rating, reviews_count, image, sponsored };
  }).filter((x) => x && x.title);
})()`;

export async function searchAmazonPage(url) {
  if (!SEARCH.test(url)) throw new Error('Поиск только по странице результатов Amazon (/s?k=…)');
  const port = await scrapeProfilePort();
  return withTab(port, url, async (cdp) => {
    if (await evalValue(cdp, ROBOT_CHECK)) {
      throw new Error('Amazon показал проверку на робота. Откройте Amazon в профиле скрапа и пройдите её вручную, затем повторите поиск');
    }
    return { items: await evalValue(cdp, SEARCH_RESULTS) };
  });
}

