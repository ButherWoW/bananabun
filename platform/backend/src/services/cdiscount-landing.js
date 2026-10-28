// Generates a Cdiscount-style landing ZIP from a product.
// Static assets are fetched from the base template on the Keitaro server.
// Product images are downloaded and packed as s1.jpg, s2.jpg, ...

const TEMPLATE_BASE_URL = process.env.CDISCOUNT_TEMPLATE_URL || 'https://whynot.partners/lander/dima-klein-knect-fr';
const BASE_URL = (process.env.BASE_URL || 'https://nespizdili.lol').replace(/\/$/, '');

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

// Convert local /uploads/... path to absolute URL
function toAbsoluteUrl(src) {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  if (src.startsWith('/')) return `${BASE_URL}${src}`;
  return null;
}

// Build specs block HTML to replace Klein meta-pairs
function buildSpecsHtml(specs) {
  if (!specs?.length) return '';
  return specs.slice(0, 5).map(s => {
    const label = esc(s.label || '');
    const value = esc(s.value || '');
    if (!label && !value) return '';
    return `<div class="meta-item">
                <span class="meta-label">${label}</span>
                <span class="meta-value">${value}</span>
              </div>`;
  }).join('\n');
}

// Build review cards HTML to replace Klein reviews
function buildReviewsHtml(reviews) {
  if (!reviews?.length) return null;
  // Generic positive replies
  const replies = [
    'Merci pour votre confiance et votre avis ! Nous sommes ravis que vous soyez satisfait.',
    'Nous sommes heureux que le produit vous convienne. Merci d\'avoir pris le temps de partager votre expérience.',
    'Votre retour compte beaucoup pour nous. Merci et à bientôt !',
  ];
  return reviews.slice(0, 5).map((rv, i) => {
    const rating = Number(rv.rating) || 5;
    const stars = '★'.repeat(Math.min(5, Math.max(1, Math.round(rating))));
    const author = esc(rv.author || `Client${i + 1}`);
    const text = esc(rv.text || '');
    const reply = replies[i % replies.length];
    return `<div class="review-card">
              <div class="review-card__header">
                <span class="review-card__stars">${stars}</span>
                <span class="review-card__author">${author}</span>
              </div>
              <p class="review-card__text">${text}</p>
              <div class="review-card__reply">
                <p class="review-card__text review-card__reply-text">${esc(reply)}</p>
              </div>
            </div>`;
  }).join('\n');
}

function buildHtml(template, product, imageCount, reviews) {
  const title = product.title || '';
  const bundles = asArray(product.bundle_config);
  const price = eur(bundles[0]?.price || product.source_price || '19.99');
  const rawOld = bundles[0]?.old_price || '';
  const oldPrice = rawOld ? eur(rawOld) : eur((Number(bundles[0]?.price || 19.99) * 8).toFixed(2));
  const specs = asArray(product.specs);

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
    // Replace Klein product title occurrences
    .replace(/Coffret douilles Klein KNECT, 39 pièces/g, esc(title))
    .replace(/Klein KNECT/g, esc(title.slice(0, 40)));

  // Replace specs block: find the meta section and replace all meta-item pairs
  if (specs.length > 0) {
    const specsHtml = buildSpecsHtml(specs);
    // Replace the entire meta-list content between Klein spec items
    html = html.replace(
      /(<span class="meta-label">Pièces<\/span>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/,
      specsHtml + '</div></div>'
    );
    // Fallback: replace individual Klein spec values
    html = html
      .replace(/<span class="meta-value">39<\/span>/, `<span class="meta-value">${esc(specs[0]?.value || '')}</span>`)
      .replace(/<span class="meta-value">21,6 cm<\/span>/, `<span class="meta-value">${esc(specs[1]?.value || '')}</span>`)
      .replace(/<span class="meta-value">90<\/span>/, `<span class="meta-value">${esc(specs[2]?.value || '')}</span>`)
      .replace(/<span class="meta-value">Cr-Mo<\/span>/, `<span class="meta-value">${esc(specs[3]?.value || '')}</span>`)
      .replace(/<span class="meta-value is-active">Orange<\/span>/, `<span class="meta-value is-active">${esc(specs[4]?.value || '')}</span>`);
    // Replace Klein spec labels too
    if (specs[0]?.label) html = html.replace(/<span class="meta-label">Pièces<\/span>/, `<span class="meta-label">${esc(specs[0].label)}</span>`);
    if (specs[1]?.label) html = html.replace(/<span class="meta-label">Cliquet<\/span>/, `<span class="meta-label">${esc(specs[1].label)}</span>`);
    if (specs[2]?.label) html = html.replace(/<span class="meta-label">Dents<\/span>/, `<span class="meta-label">${esc(specs[2].label)}</span>`);
    if (specs[3]?.label) html = html.replace(/<span class="meta-label">Acier<\/span>/, `<span class="meta-label">${esc(specs[3].label)}</span>`);
    if (specs[4]?.label) html = html.replace(/<span class="meta-label">Coloris :<\/span>/, `<span class="meta-label">${esc(specs[4].label)}</span>`);
  }

  // Replace Klein-specific review texts with product reviews (if available)
  if (reviews?.length) {
    // Replace the two Klein-specific review texts
    html = html
      .replace(
        /Les douilles colorées se repèrent tout de suite dans la mallette\./,
        esc(reviews[0]?.text || '')
      )
      .replace(
        /Excellente qualité, livraison rapide et conforme à la description\. L'un des meilleurs achats en ligne que j'aie faits ces derniers temps\./,
        esc(reviews[1]?.text || reviews[0]?.text || '')
      );
  }

  // Fix image references
  for (let i = 1; i <= imageCount; i++) {
    html = html.replace(new RegExp(`\\.\\./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
    html = html.replace(new RegExp(`./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
  }
  return html.replace(/\.\/assets\/s\d+\.svg(\?v=\d+)?/g, './assets/s1.jpg');
}

export async function buildCdiscountZip({ product, templateBaseUrl = TEMPLATE_BASE_URL, reviews = [] }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const templateHtml = (await fetchBuf(`${templateBaseUrl}/index.html`)).toString('utf8');

  // Convert local /uploads/... paths to absolute URLs
  const imageUrls = asArray(product.images)
    .map(img => {
      const src = typeof img === 'string' ? img : img?.url || img?.src || '';
      return toAbsoluteUrl(src);
    })
    .filter(Boolean).slice(0, 8);

  const downloaded = (await Promise.all(
    imageUrls.map(async (url, i) => {
      try { return { i, buf: await fetchBuf(url) }; }
      catch (e) { console.warn(`[cdiscount] skip image ${i + 1}: ${e.message}`); return null; }
    })
  )).filter(Boolean);

  zip.file('index.html', Buffer.from(buildHtml(templateHtml, product, downloaded.length, reviews), 'utf8'));

  await Promise.all(STATIC_ASSETS.map(async (p) => {
    try { zip.file(p, await fetchBuf(`${templateBaseUrl}/${p}`)); }
    catch (e) { console.warn(`[cdiscount] skip ${p}: ${e.message}`); }
  }));

  for (const { i, buf } of downloaded) zip.file(`assets/s${i + 1}.jpg`, buf);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
