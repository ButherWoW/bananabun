import { db } from '../db/client.js';
import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { trackerScript } from './lp-tracker.js';
import { words, langOf } from './landing-i18n.js';

// «{» is escaped too, so a «{{…}}» inside scraped text is never expanded as a placeholder.
const esc = (v) => String(v ?? '').replace(/[&<>"'{]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;' }[c]));
const SYMBOL = { EUR: '€', USD: '$', GBP: '£', PLN: 'zł', CHF: 'CHF' };

function asArray(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

// The landing is served from a Keitaro domain: our own /uploads paths must be absolute.
// Absolute links go under the panel's base (https://nespizdili.lol/banana); old /uploads and /api keep working.
const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || 'https://nespizdili.lol').replace(/\/$/, '');
function imageUrl(img) {
  const u = typeof img === 'string' ? img : img?.url || img?.src || '';
  return u.startsWith('/') && !u.startsWith('//') ? PUBLIC_URL + u : u;
}

// The offer link is built in the browser by the Keitaro offer script (landing-assets/keitaro-offer.js,
// the same one the team's Keitaro landings use): offer_id of the chosen bundle + all sub_ids,
// from window.location.origin — so the landing must be uploaded as local into the same stream.
const OFFER_JS = readFileSync(new URL('./landing-assets/keitaro-offer.js', import.meta.url), 'utf8');

function money(v, currency) {
  const n = Number(v);
  if (!(n > 0)) return '';
  const s = SYMBOL[currency] || currency || '';
  return currency === 'EUR' || currency === 'PLN' || currency === 'CHF' ? `${n.toFixed(2).replace('.', ',')} ${s}` : `${s}${n.toFixed(2)}`;
}

const bundleLabel = (b, t) => b.name || `${b.qty} ${t.pieces}`;

// .product-choice[data-product="b<i>"] is the contract of the offer script: it reads the choice from it.
function bundlesHtml(bundles, t) {
  if (!bundles.length) return '';
  return `<div class="choose">${esc(t.choose)}</div><div class="bb-bundles" role="radiogroup" aria-label="${esc(t.choose)}" data-block="bundles">${bundles.map((b, i) => {
    const cur = b.currency || 'EUR';
    const old = Number(b.old_price) > Number(b.price) ? money(b.old_price, cur) : '';
    return `<button type="button" class="product-choice${i === 0 ? ' is-selected' : ''}" data-product="b${i}" data-bundle="${esc(b.qty)}" aria-pressed="${i === 0}">
  <span class="product-choice__radio"></span><span class="product-choice__name">${esc(bundleLabel(b, t))}</span>
  <span class="product-choice__price">${money(b.price, cur)}${old ? `<s>${old}</s>` : ''}</span>
</button>`;
  }).join('\n')}</div>`;
}

// What the offer script needs: bundles (offer_id, price, old_price, qty, label) and title/photos.
function offerData(product, bundles, images, t, templateId) {
  return {
    title: product.title || '',
    short_title: String(product.title || '').split(/[,–—|(]/)[0].trim().slice(0, 80),
    photos: images.map(imageUrl).filter(u => /^https?:\/\//.test(u)).slice(0, 8),
    tracking_slug: `bb-${templateId}`,
    bundles: bundles.map(b => ({
      offer_id: b.offer_id ?? null, price: b.price ?? '', old_price: Number(b.old_price) > Number(b.price) ? b.old_price : '',
      qty: b.qty ?? '1', currency: b.currency || 'EUR',
      fa_price: money(b.price, b.currency || 'EUR'),
      fa_compare: Number(b.old_price) > Number(b.price) ? money(b.old_price, b.currency || 'EUR') : '',
      fa_label: bundleLabel(b, t),
    })),
  };
}
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function galleryHtml(images, title) {
  const urls = images.map(imageUrl).filter(u => /^https?:\/\//.test(u)).slice(0, 8);
  if (!urls.length) return '';
  return `<div class="bb-gallery" data-block="gallery">${urls.map((u, i) => `<img src="${esc(u)}" alt="${esc(title)}" loading="${i ? 'lazy' : 'eager'}">`).join('')}</div>`;
}

// Stars only for a real 1–5 rating.
function starsOf(rating) {
  const n = Math.round(Number(rating));
  return n >= 1 && n <= 5 ? ` <span class="bb-stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';
}

function reviewsHtml(reviews, t) {
  if (!reviews.length) return '';
  return `<section class="bb-reviews" data-block="reviews"><h2>${esc(t.reviews)}</h2>${reviews.map(r => `
<div class="bb-review"><div class="bb-review-head"><b>${esc(r.author || '')}</b>${starsOf(r.rating)}</div><p>${esc(r.text || '')}</p></div>`).join('')}</section>`;
}

function specsHtml(specs, t) {
  const rows = Array.isArray(specs) ? specs.map(s => Array.isArray(s) ? s : [s?.name ?? s?.key, s?.value])
    : specs && typeof specs === 'object' ? Object.entries(specs) : [];
  const ok = rows.filter(([k, v]) => k && v != null && v !== '');
  if (!ok.length) return '';
  return `<section class="bb-specs" data-block="specs"><h2>${esc(t.specs)}</h2><table>${ok.slice(0, 20).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></section>`;
}

export async function compileLanding(templateId, productId, geo = 'FR', ws) {
  if (!ws) throw new Error('workspace required');
  const template = await db.findOne('landing_templates', { id: templateId, workspace_id: ws });
  if (!template) throw new Error('Template not found');

  const product = await db.findOne('products', { id: productId, workspace_id: ws });
  if (!product) throw new Error('Product not found');

  const G = String(geo || 'FR').toUpperCase();
  if (!/^[A-Z]{2}$/.test(G)) throw new Error('Гео — код из двух букв');
  const version = asArray(template.versions).find(v => String(v.geo || '').toUpperCase() === G);
  let html = version?.html || template.html || template.html_content || template.content || '';
  if (!html && template.file_url) html = await readFile('.' + template.file_url, 'utf8').catch(() => '');
  if (!String(html).trim()) throw new Error('У шаблона нет HTML — его нельзя собрать (шаблоны FA без файла не годятся)');

  const t = words(G);
  const images = asArray(product.images);
  const mainImage = imageUrl(images[0]);
  const bundles = asArray(product.bundle_config);
  // Our store sells only through Keitaro offers: without them the buy button would send an empty offer_id.
  if (template.type === 'store' && (!bundles.length || bundles.some(b => !b.offer_id))) {
    throw new Error('У товара нет комплектов с оффером Keitaro — добавьте комплекты с оффером, иначе кнопка покупки никуда не ведёт');
  }
  const { rows: reviews } = await db.query(
    `SELECT author, rating, text FROM product_reviews WHERE product_id = $1 AND COALESCE(text, '') <> '' ORDER BY created_at LIMIT 12`, [product.id]);
  const currency = bundles[0]?.currency || 'EUR';
  const price1 = bundles[0]?.price || product.source_price || '';
  const oldPrice = bundles[0]?.old_price || '';
  const ratingRaw = Number(product.rating);
  const realRating = ratingRaw > 0 && ratingRaw <= 5 ? ratingRaw : null;

  // Text placeholders are escaped; *_html placeholders are blocks we build ourselves.
  const subs = {
    '{{title}}': esc(product.title),
    '{{name}}': esc(product.title),
    '{{product_name}}': esc(product.title),
    '{{description}}': esc(product.description).replace(/\n/g, '<br>'),
    '{{price}}': esc(price1),
    '{{price_1}}': esc(price1),
    '{{price_2}}': esc(bundles[1]?.price || ''),
    '{{price_3}}': esc(bundles[2]?.price || ''),
    '{{old_price}}': esc(oldPrice),
    '{{price_fmt}}': money(price1, currency),
    '{{old_price_fmt}}': Number(oldPrice) > Number(price1) ? money(oldPrice, currency) : '',
    '{{currency}}': esc(SYMBOL[currency] || currency),
    '{{image}}': esc(mainImage),
    '{{image_url}}': esc(mainImage),
    '{{main_image}}': esc(mainImage),
    '{{geo}}': G,
    '{{lang}}': langOf(G),
    '{{store}}': esc(template.store || 'Store'),
    '{{year}}': String(new Date().getFullYear()),
    '{{save_html}}': Number(oldPrice) > Number(price1) && Number(price1) > 0
      ? `<span class="save">−${Math.round((1 - Number(price1) / Number(oldPrice)) * 100)}%</span>` : '',
    '{{description_html}}': product.description
      ? `<section data-block="description"><h2>${esc(t.description)}</h2><div class="desc">${esc(product.description).replace(/\n/g, '<br>')}</div></section>` : '',
    // The marketplace's count only; reviews added by hand are not a count of buyers.
    '{{reviews_count}}': Number(product.reviews_count) > 0 ? String(Number(product.reviews_count)) : '',
    // Only the real Amazon rating; without one the placeholder stays empty — never a made-up number.
    '{{rating}}': realRating != null ? String(realRating) : '',
    '{{rating_html}}': realRating != null ? `<span class="bb-rating">★ ${realRating} / 5${product.reviews_count ? ` · ${Number(product.reviews_count)}` : ''}</span>` : '',
    '{{bundles_html}}': bundlesHtml(bundles, t),
    '{{gallery_html}}': galleryHtml(images, product.title),
    '{{reviews_html}}': reviewsHtml(reviews, t),
    '{{specs_html}}': specsHtml(product.specs, t),
  };
  for (const [k, v] of Object.entries(t)) subs[`{{t.${k}}}`] = esc(v);

  for (const [key, val] of Object.entries(subs)) html = html.replaceAll(key, () => val);

  images.forEach((img, i) => { html = html.replaceAll(`{{image_${i}}}`, () => esc(imageUrl(img))); });
  reviews.slice(0, 5).forEach((rev, i) => {
    html = html.replaceAll(`{{review_${i}_text}}`, () => esc(rev.text));
    html = html.replaceAll(`{{review_${i}_author}}`, () => esc(rev.author));
    html = html.replaceAll(`{{review_${i}_rating}}`, () => (rev.rating != null ? String(rev.rating) : ''));
  });
  // Placeholders with no data (review_7_text, image_9 …) must not leak onto the page.
  html = html.replace(/\{\{\s*(review_\d+_(text|author|rating)|image_\d+)\s*\}\}/g, '');

  // Offer data + the Keitaro offer script (builds the buy link), then our visitor tracker.
  // The offer script is ours only for our store template: uploaded landings bring their own KEITARO_OFFERS
  // and must not be overwritten. A white page gets nothing (moderators see it).
  const isStore = template.type === 'store';
  const isService = template.type === 'white';
  const tail = (isStore
    ? `<script>window.FA_PRODUCT = ${jsonForScript(offerData(product, bundles, images, t, template.id))};</script><script>${OFFER_JS}</script>`
    : '')
    + (isService ? '' : trackerScript({ templateId: template.id, productId: product.id, geo: G }));
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${tail}</body>`) : html + tail;

  return { html, product, template };
}
