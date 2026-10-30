// Generates an Angry-style Cdiscount landing ZIP (with survey gate).
// Uses the "Template 2" Angry landing as the base; swaps product data only.
import { productImageBytes } from './creative-assets.js';

const TEMPLATE_BASE_URL = process.env.ANGRY_TEMPLATE_URL
  || 'https://whynot.partners/lander/angry--tefal-ingenio-emotion-13-pi--ces-----template-2';

const STATIC_ASSETS = [
  'assets/keitaro.js', 'assets/script.js', 'assets/styles.css',
  'assets/cdiscount-theme.css', 'assets/checkout-main.js',
  'assets/logo.svg', 'assets/favicon.svg', 'assets/visa.svg', 'assets/mastercard.svg',
  'assets/1693143597e6496fd9a7.svg', 'assets/169314359717e4f6b69a.svg',
  'assets/169314359898115a61c0.svg', 'assets/1693143598268fd9467c.svg',
  'assets/1693143625fda44caa3f.svg', 'assets/1693143597aedb129fca.svg',
  'assets/av1.svg', 'assets/av3.svg', 'assets/unnamed.svg',
  'assets/comments_1_av2.svg', 'assets/comments_1_av4.svg',
  'assets/comments_1_av5.svg', 'assets/comments_1_av6.svg',
  'assets/review-r1.svg', 'assets/review-r2.svg',
];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = (v) => { const n = Number(v); return n ? n.toFixed(2).replace('.', ',') + ' €' : ''; };

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

async function fetchBuf(url, ms = 12000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildHtml(template, product, imageCount) {
  const title = product.title || '';
  const bundles = asArray(product.bundle_config);
  const price = eur(bundles[0]?.price || product.source_price || '19.99');
  const rawOld = bundles[0]?.old_price || '';
  const oldPrice = rawOld ? eur(rawOld) : eur((Number(bundles[0]?.price || 19.99) * 8).toFixed(2));
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const label = '1 ' + title;

  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>Cdiscount – ${esc(title)}</title>`)
    .replace(/window\.KEITARO_PRODUCT=\{[^}]+\};/,
      `window.KEITARO_PRODUCT={title:${JSON.stringify(title)},sourceId:${JSON.stringify(title)},trackingSlug:${JSON.stringify(slug + '-fr-direct-v1')},imageDefault:'./assets/product-01.jpg'};`)
    .replace(/window\.KEITARO_OFFERS=\{[\s\S]*?\};/,
      `window.KEITARO_OFFERS={single:{id:'313',price:${JSON.stringify(price)},compare:${JSON.stringify(oldPrice)},label:${JSON.stringify(label)},qty:'1'},pack3:{id:'313',price:${JSON.stringify(price)},compare:${JSON.stringify(oldPrice)},label:${JSON.stringify(label)},qty:'1'}};`)
    .replace(/window\.KEITARO_SELECTED\s*=\s*[^;]+;/g, 'window.KEITARO_SELECTED = window.KEITARO_OFFERS.single;');

  // Replace survey intro product mention
  html = html.replace(
    /(<strong>)[^<]*(<\/strong>)\s*⚡/,
    `$1${esc(title)}$2 ⚡`
  );

  // Replace survey Q1 (product usage question)
  html = html.replace(
    /Avez-vous d[^?]+\?(\s*\n)/,
    `Avez-vous déjà utilisé ce type de produit ?$1`
  );

  return html;
}

export async function buildAngryZip({ product, templateBaseUrl = TEMPLATE_BASE_URL }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const templateHtml = (await fetchBuf(`${templateBaseUrl}/index.html`)).toString('utf8');

  const imageUrls = asArray(product.images)
    .map(img => (typeof img === 'string' ? img : img?.url || img?.src || ''))
    .filter(Boolean).slice(0, 8);

  const downloaded = (await Promise.all(
    imageUrls.map(async (url, i) => {
      try { const buf = await productImageBytes(url); return buf ? { i, buf } : null; }
      catch (e) { console.warn(`[angry] skip image ${i + 1}: ${e.message}`); return null; }
    })
  )).filter(Boolean);

  zip.file('index.html', Buffer.from(buildHtml(templateHtml, product, downloaded.length), 'utf8'));

  await Promise.all(STATIC_ASSETS.map(async (p) => {
    try { zip.file(p, await fetchBuf(`${templateBaseUrl}/${p}`)); }
    catch (e) { console.warn(`[angry] skip ${p}: ${e.message}`); }
  }));

  // Angry template uses product-01.jpg, product-02.jpg, ...
  for (const { i, buf } of downloaded) {
    const n = String(i + 1).padStart(2, '0');
    zip.file(`assets/product-${n}.jpg`, buf);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
