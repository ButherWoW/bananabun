// Generates a Cdiscount-style landing ZIP from a product.
// Static assets are fetched from the base template on the Keitaro server.
// Product images are downloaded and packed as s1.jpg, s2.jpg, ...

const TEMPLATE_BASE_URL = process.env.CDISCOUNT_TEMPLATE_URL || 'https://whynot.partners/lander/dima-klein-knect-fr';

const STATIC_ASSETS = [
  'assets/keitaro.js', 'assets/script.js', 'assets/styles.css',
  'assets/cdiscount-theme.css', 'assets/checkout-main.js',
  'assets/logo.svg', 'assets/favicon.svg', 'assets/visa.svg', 'assets/mastercard.svg',
  'assets/av1.svg', 'assets/av3.svg', 'assets/unnamed.svg',
  'assets/1693143597e6496fd9a7.svg', 'assets/169314359717e4f6b69a.svg',
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

  let html = template
    .replace(/window\.LANDING_PRODUCT\s*=\s*\{[\s\S]*?\};/,
      `window.LANDING_PRODUCT = {\n` +
      `        storeName: "Cdiscount",\n` +
      `        title: ${JSON.stringify(title)},\n` +
      `        priceCurrent: ${JSON.stringify(price)},\n` +
      `        priceOld: ${JSON.stringify(oldPrice)},\n` +
      `        reviewGender: "A",\n` +
      `        imageDefault: "./assets/s1.jpg",\n` +
      `        offerQty: 1,\n` +
      `      };`)
    .replace(/<title>[^<]*<\/title>/, `<title>Cdiscount – ${esc(title)}</title>`)
    .replace(/Coffret douilles Klein KNECT, 39 pièces/g, esc(title));

  for (let i = 1; i <= imageCount; i++) {
    html = html.replace(new RegExp(`\\.\\./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
    html = html.replace(new RegExp(`./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
  }
  return html.replace(/\.\/assets\/s\d+\.svg(\?v=\d+)?/g, './assets/s1.jpg');
}

export async function buildCdiscountZip({ product, templateBaseUrl = TEMPLATE_BASE_URL }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const templateHtml = (await fetchBuf(`${templateBaseUrl}/index.html`)).toString('utf8');

  const imageUrls = asArray(product.images)
    .map(img => (typeof img === 'string' ? img : img?.url || img?.src || ''))
    .filter(Boolean).slice(0, 8);

  const downloaded = (await Promise.all(
    imageUrls.map(async (url, i) => {
      try { return { i, buf: await fetchBuf(url) }; }
      catch (e) { console.warn(`[cdiscount] skip image ${i + 1}: ${e.message}`); return null; }
    })
  )).filter(Boolean);

  zip.file('index.html', Buffer.from(buildHtml(templateHtml, product, downloaded.length), 'utf8'));

  await Promise.all(STATIC_ASSETS.map(async (p) => {
    try { zip.file(p, await fetchBuf(`${templateBaseUrl}/${p}`)); }
    catch (e) { console.warn(`[cdiscount] skip ${p}: ${e.message}`); }
  }));

  for (const { i, buf } of downloaded) zip.file(`assets/s${i + 1}.jpg`, buf);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
