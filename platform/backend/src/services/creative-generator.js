import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { localImageData } from './creative-assets.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Template styles — each defines a unique look
const STYLES = ['clean', 'dark', 'gradient', 'bold', 'minimal'];

const LABELS = {
  fr: { cta: 'Commandez maintenant', sale: 'PROMO', off: 'de réduction', shipping: 'Livraison rapide' },
  es: { cta: 'Compra ahora', sale: 'OFERTA', off: 'de descuento', shipping: 'Envío rápido' },
  en: { cta: 'Order now', sale: 'SALE', off: 'off', shipping: 'Fast shipping' },
  de: { cta: 'Jetzt kaufen', sale: 'ANGEBOT', off: 'Rabatt', shipping: 'Schneller Versand' },
  pt: { cta: 'Compre agora', sale: 'PROMOÇÃO', off: 'de desconto', shipping: 'Entrega rápida' },
  it: { sale: 'OFFERTA' },
  nl: { sale: 'AANBIEDING' },
};

function getLabels(lang) {
  return LABELS[lang] || LABELS.en;
}

function calcDiscount(oldPrice, newPrice) {
  if (!oldPrice || !newPrice || oldPrice <= newPrice) return null;
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

function formatPrice(price, currency = '€') {
  if (!price) return null;
  return `${Number(price).toFixed(2).replace('.', ',')} ${currency}`;
}

export function buildCreativeHtml(style, { title, imageUrl, oldPrice, newPrice, discount, features, lang, currency, headline, logoUrl }) {
  const labels = getLabels(lang);
  const oldFmt = formatPrice(oldPrice, currency);
  const newFmt = formatPrice(newPrice, currency);

  const shortTitle = title && title.length > 60 ? title.slice(0, 57) + '…' : (title || '');

  const featureList = (features || []).slice(0, 3).map(f =>
    `<div class="feature"><span class="dot">✓</span>${esc(f)}</div>`
  ).join('');

  const discountBadge = discount ? `<div class="badge">-${discount}%</div>` : '';
  const priceBlock = newFmt ? `
    <div class="price-row">
      ${oldFmt ? `<span class="old-price">${oldFmt}</span>` : ''}
      <span class="new-price">${newFmt}</span>
    </div>` : '';

  const styles = {
    clean: {
      bg: '#FFFFFF',
      accent: '#E63946',
      textColor: '#111827',
      cardBg: '#F9FAFB',
      badgeBg: '#E63946',
      featureColor: '#374151',
      priceNew: '#16A34A',
      priceOld: '#9CA3AF',
    },
    dark: {
      bg: '#0F172A',
      accent: '#F59E0B',
      textColor: '#F1F5F9',
      cardBg: '#1E293B',
      badgeBg: '#F59E0B',
      featureColor: '#CBD5E1',
      priceNew: '#4ADE80',
      priceOld: '#64748B',
    },
    gradient: {
      bg: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
      accent: '#FBBF24',
      textColor: '#FFFFFF',
      cardBg: 'rgba(255,255,255,0.15)',
      badgeBg: '#FBBF24',
      featureColor: '#E2E8F0',
      priceNew: '#BBF7D0',
      priceOld: 'rgba(255,255,255,0.6)',
    },
    bold: {
      bg: 'linear-gradient(180deg, #DC2626 0%, #991B1B 100%)',
      accent: '#FFFFFF',
      textColor: '#FFFFFF',
      cardBg: 'rgba(0,0,0,0.2)',
      badgeBg: '#FFDD00',
      featureColor: '#FCA5A5',
      priceNew: '#FFDD00',
      priceOld: 'rgba(255,255,255,0.5)',
    },
    minimal: {
      bg: '#F8F9FA',
      accent: '#3B82F6',
      textColor: '#1F2937',
      cardBg: '#FFFFFF',
      badgeBg: '#3B82F6',
      featureColor: '#4B5563',
      priceNew: '#059669',
      priceOld: '#9CA3AF',
    },
  };

  const t = styles[style] || styles.clean;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: 100vw;
  height: 100vh;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  background: ${t.bg};
  color: ${t.textColor};
  overflow: hidden;
  position: relative;
}
.wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 50px 36px;
}
.brand-logo { position:absolute;top:24px;left:32px;width:180px;height:72px;object-fit:contain;object-position:left center;z-index:10; }
.headline { font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px;overflow-wrap:anywhere; }
.badge {
  position: absolute;
  top: 32px;
  right: 32px;
  background: ${t.badgeBg};
  color: #000;
  font-size: 28px;
  font-weight: 900;
  padding: 10px 18px;
  border-radius: 50px;
  letter-spacing: -0.5px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 10;
}
.label-sale {
  position: absolute;
  top: 32px;
  left: 32px;
  background: ${t.accent};
  color: ${style === 'bold' ? '#000' : '#fff'};
  font-size: 18px;
  font-weight: 800;
  padding: 6px 16px;
  border-radius: 6px;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.product-image {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
  padding: 60px 30px 20px;
}
.product-image img {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  filter: drop-shadow(0 8px 32px rgba(0,0,0,0.25));
}
.info-card {
  width: 100%;
  background: ${t.cardBg};
  border-radius: 20px;
  padding: 22px 28px 18px;
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}
.product-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 14px;
  color: ${t.textColor};
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.price-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.old-price {
  font-size: 24px;
  color: ${t.priceOld};
  text-decoration: line-through;
  font-weight: 500;
}
.new-price {
  font-size: 42px;
  font-weight: 900;
  color: ${t.priceNew};
  line-height: 1;
  letter-spacing: -1px;
}
.features {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.feature {
  font-size: 15px;
  color: ${t.featureColor};
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  color: ${t.accent};
  font-weight: 700;
  flex-shrink: 0;
}
.shipping-line {
  margin-top: 14px;
  font-size: 13px;
  color: ${t.featureColor};
  opacity: 0.8;
  text-align: center;
  font-weight: 500;
  letter-spacing: 0.3px;
}
</style>
</head>
<body>
<div class="wrapper">
  ${discountBadge}
  ${logoUrl ? `<img class="brand-logo" src="${esc(logoUrl)}" alt="" />` : discount ? `<div class="label-sale">${esc(labels.sale)}</div>` : ''}

  <div class="product-image">
    <img src="${esc(imageUrl)}" alt="" />
  </div>

  <div class="info-card">
    ${headline ? `<div class="headline">${esc(headline)}</div>` : ''}
    <div class="product-title">${esc(shortTitle)}</div>
    ${priceBlock}
    <div class="features">${featureList}</div>
  </div>
</div>
</body>
</html>`;
}

let browser = null;
let launching = null;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  if (!launching) launching = chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    .then(value => { browser=value; return value; }).finally(() => { launching=null; });
  return launching;
}

export async function closeCreativeBrowser() {
  if (launching) await launching;
  const current=browser; browser=null;
  if (current) await current.close();
}

async function renderHtmlToImage(html, width = 1080, height = 1080) {
  const b = await getBrowser();
  const page = await b.newPage({ javaScriptEnabled:false });
  try {
    await page.route('**/*', route => route.abort());
    page.setDefaultTimeout(30000);
    await page.setViewportSize({ width, height });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await Promise.all([...document.images].map(async image => {
        await image.decode();
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Изображение повреждено или слишком большое');
      }));
    });
    const full = await page.screenshot({ type: 'jpeg', quality: 90 });

    // Thumbnail at 400px wide
    await page.setViewportSize({ width: 400, height: Math.round(400 * height / width) });
    await page.setContent(`<html><body style="margin:0"><img style="display:block;width:100vw;height:100vh" src="data:image/jpeg;base64,${full.toString('base64')}"></body></html>`, { waitUntil: 'load' });
    const thumb = await page.screenshot({ type: 'jpeg', quality: 70 });

    return { full, thumb };
  } finally {
    await page.close();
  }
}

export async function generateCreative(product, preset, format, opts = {}) {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    const { language = 'fr', landing_price, style, features, image, headline, logo_key } = opts;

    const images = Array.isArray(product.images)
      ? product.images
      : (typeof product.images === 'string' ? JSON.parse(product.images || '[]') : []);

    const rawImageUrl = image || images[0]?.url || images[0] || null;
    if (!rawImageUrl) throw new Error('Добавьте фото товара или референс перед созданием креатива');
    const imageUrl = await localImageData(rawImageUrl);
    const logoUrl = logo_key ? await localImageData(logo_key) : null;
    const oldPrice = product.source_price;
    const newPrice = landing_price || null;
    const discount = calcDiscount(oldPrice, newPrice);

    // Auto-extract features from product description
    let autoFeatures = features || [];
    if (!autoFeatures.length && product.description) {
      autoFeatures = product.description
        .split(/[.\n•·]/)
        .map(s => s.trim())
        .filter(s => s.length > 15 && s.length < 80)
        .slice(0, 3);
    }

    // Detect format dimensions
    const DIMS = {
      '1x1': [1080, 1080],
      '3x2': [1200, 800],
      '2x3': [800, 1200],
      '4x5': [1080, 1350],
      '9x16': [1080, 1920],
    };
    const [w, h] = DIMS[format] || [1080, 1080];

    const pickedStyle = style || STYLES[Math.floor(Math.random() * STYLES.length)];

    const html = buildCreativeHtml(pickedStyle, {
      title: product.title,
      imageUrl,
      oldPrice,
      newPrice,
      discount,
      features: autoFeatures,
      lang: language,
      currency: '€',
      headline,
      logoUrl,
    });

    const { full: imgBuf, thumb: thumbBuf } = await renderHtmlToImage(html, w, h);

    const filename = `cr_${nanoid(16)}.jpg`;
    const filepath = path.join(UPLOADS_DIR, filename);
    await fs.writeFile(filepath, imgBuf);

    const thumbname = `thumb_${filename}`;
    const thumbPath = path.join(UPLOADS_DIR, thumbname);
    await fs.writeFile(thumbPath, thumbBuf);

    return {
      url: `/uploads/${filename}`,
      thumbnail: `/uploads/${thumbname}`,
      style: pickedStyle,
      language,
    };
  } catch (err) {
    throw err;
  }
}

export async function generateCreatives(product, opts = {}) {
  const {
    language = 'fr',
    landing_price,
    styles,
    count = 3,
    features,
    format = '1x1',
  } = opts;

  const pickedStyles = styles || STYLES.slice(0, count);

  const results = await Promise.all(
    pickedStyles.map(style =>
      generateCreative(product, null, format, { language, landing_price, style, features })
    )
  );

  return results.filter(Boolean);
}
