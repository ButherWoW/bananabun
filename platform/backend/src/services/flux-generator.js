import path from 'path';
import fs from 'fs/promises';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { localImageData } from './creative-assets.js';
import { falOutputCost, totalCost } from './fal-pricing.js';

const FAL_BASE = 'https://fal.run';
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
export const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/ideogram/v2';
const IS_FLUX = /\/flux\//i.test(FAL_MODEL);
const REMIX_MODEL = 'fal-ai/ideogram/v2/remix';

// Ideogram v2 uses aspect_ratio strings; FLUX uses named sizes
const FORMAT_TO_ASPECT = {
  '1x1': '1:1',
  '4x5': '4:5',
  '9x16': '9:16',
  '3x2': '3:2',
  '2x3': '2:3',
  '16x9': '16:9',
};

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

// Scene templates for visual diversity — each slot gets a different composition
const SCENE_TEMPLATES = [
  // 0: Hero product on clean background
  (product) => `Place the ${product} as the hero product centered on a clean, modern background with soft studio lighting; keep composition uncluttered with clear space in the upper area for a logo badge. Use high contrast lighting to make product details pop.`,
  // 1: Lifestyle in use
  (product) => `Show the ${product} in a lifestyle setting — in use in a real home environment, warm natural light, inviting atmosphere; leave a clear area in a corner for logo. Scene should feel authentic and aspirational.`,
  // 2: Dark dramatic
  (product) => `Create a dramatic close-up of the ${product} against a deep jewel-toned dark background (navy or charcoal); crisp, high-contrast lighting; reserve a clear bright area for a logo in the top corner.`,
  // 3: Bright airy pastel
  (product) => `Show the ${product} in a bright, airy composition on a pale pastel or white background; fresh minimalist feel, soft shadows; leave a clean zone in the upper-left corner for logo placement.`,
  // 4: Detail feature shot
  (product) => `Create a close-up detail shot highlighting key features of the ${product}; use a contrasting backdrop that complements the product color; reserve a clearly separated area for logo badge.`,
];

const CTAS = {
  fr: ['J\'en profite', 'Découvrir', 'Commander', 'Voir l\'offre', 'Je commande'],
  es: ['Lo quiero', 'Ver oferta', 'Comprar', 'Aprovechar', 'Pedir ahora'],
  en: ['Shop now', 'Order now', 'Get it', 'Buy now', 'See offer'],
  de: ['Jetzt kaufen', 'Entdecken', 'Bestellen', 'Angebot sehen', 'Kaufen'],
  it: ['Acquista ora', 'Scopri', 'Ordina', 'Vedi offerta', 'Approfitta'],
  pt: ['Comprar agora', 'Ver oferta', 'Pedir', 'Aproveitar', 'Descobrir'],
};

// Neutral headlines: no invented urgency (limited time, flash sale) or claims the product data cannot back up.
export const HEADLINES = {
  fr: ['Bon plan', 'À découvrir', 'Fait pour vous', 'Le bon choix', 'À petit prix'],
  es: ['Buena compra', 'Descúbrelo', 'Hecho para ti', 'La buena elección', 'A buen precio'],
  en: ['Good buy', 'Discover it', 'Made for you', 'A smart choice', 'Great value'],
  de: ['Gute Wahl', 'Entdecken', 'Für dich gemacht', 'Clevere Wahl', 'Guter Preis'],
  it: ['Buon acquisto', 'Scoprilo', 'Fatto per te', 'La scelta giusta', 'Buon prezzo'],
  pt: ['Boa compra', 'Descubra', 'Feito para você', 'A escolha certa', 'Bom preço'],
};

function discountPct(oldPrice, newPrice) {
  const o = parseFloat(oldPrice), n = parseFloat(newPrice);
  if (!o || !n || o <= n) return null;
  return `-${Math.round((1 - n / o) * 100)} %`;
}

function buildDirection(product, slot, options = {}) {
  const { language = 'fr', headline, landing_price } = options;
  const lang = language in CTAS ? language : 'fr';

  const bundles = asArray(product.bundle_config);
  const bundle = bundles[0] || {};
  const newPrice = landing_price || bundle.price || product.source_price;
  const oldPrice = bundle.old_price;
  const currency = bundle.currency || (lang === 'uk' ? '£' : lang === 'us' ? '$' : '€');
  const currSign = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency;

  const title = (product.title || 'Product').slice(0, 80);
  const specs = asArray(product.specs).slice(0, 3).map(s => s.value || s.label).filter(Boolean);
  const subline = specs[slot % specs.length] || specs[0] || '';

  const ctas = CTAS[lang];
  const headlines = HEADLINES[lang];
  const cta = ctas[slot % ctas.length];
  const pct = oldPrice && newPrice ? discountPct(oldPrice, newPrice) : null;

  // If user typed a long instruction (in idea field), use it as extra direction, not as headline text
  const isInstruction = headline && headline.length > 60;
  const extraInstruction = isInstruction ? `Additional requirements: ${headline}. ` : '';
  const headlineText = isInstruction ? headlines[slot % headlines.length] : (headline || headlines[slot % headlines.length]);

  // Build the visual scene direction
  const scene = SCENE_TEMPLATES[slot % SCENE_TEMPLATES.length](title);

  // Price text block — always render when we have any price data
  const priceBlock = [
    oldPrice ? `crossed-out price « ${oldPrice} ${currSign} »` : null,
    newPrice ? `large bold new price « ${newPrice} ${currSign} »` : null,
    pct ? `bright discount badge « ${pct} »` : null,
  ].filter(Boolean).join(', ');

  // French/target-language text instruction
  const langName = { fr: 'French', es: 'Spanish', en: 'English', de: 'German', it: 'Italian', pt: 'Portuguese' }[lang] || 'French';
  const textItems = [
    `headline « ${headlineText} »`,
    subline ? `feature text « ${subline} »` : null,
    priceBlock || null,
    `CTA button « ${cta} »`,
  ].filter(Boolean).join(', ');

  // Ideogram renders text best when it's quoted and listed explicitly
  return `${scene} ${extraInstruction}Text elements to render EXACTLY as written (${langName} only): ${textItems}. Use large bold typography for prices. Strikethrough the old price. Make the discount badge highly visible with contrasting colors. Polished professional Facebook ad composition.`;
}

export function buildPrompt(product, slot = 0, options = {}) {
  return buildDirection(product, slot, options);
}

export function fluxEnabled() {
  return !!process.env.FAL_API_KEY;
}

function asImages(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

// fal.ai fetches image_url itself: our own files go as data URIs (they are not reachable by a relative path),
// and only https addresses are passed through. Older rows store {url} objects instead of strings.
async function productPhotoForFal(images) {
  for (const item of asImages(images)) {
    const src = typeof item === 'string' ? item : item?.url;
    if (typeof src !== 'string') continue;
    if (src.startsWith('/uploads/')) {
      const data = await localImageData(src).catch(() => null);
      if (data) return { src, image_url: data };
    } else if (/^https:\/\//i.test(src)) {
      return { src, image_url: src };
    }
  }
  return null;
}

async function compositeLogoOnImage(imgBuf, logoKey) {
  const dataUri = await localImageData(logoKey).catch(() => null);
  if (!dataUri) return imgBuf;
  const logoBuf = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
  const { width } = await sharp(imgBuf).metadata();
  const logoSize = Math.round((width || 1024) * 0.18);
  const margin = Math.round((width || 1024) * 0.03);
  const resized = await sharp(logoBuf).resize(logoSize, logoSize, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp(imgBuf)
    .composite([{ input: resized, top: margin, left: margin, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function callFal(key, model, body) {
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`fal.ai ${res.status}: ${errText.slice(0, 300)}`);
  }
  const imageUrl = (await res.json()).images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai не вернул изображение');
  return imageUrl;
}

export async function generateFluxCreative(product, logoKey, format = '1x1', options = {}, slot = 0) {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_API_KEY не настроен');

  const photo = await productPhotoForFal(product.images);

  const prompt = buildPrompt(product, slot, options);
  const fmt = String(format).replace(':', 'x');
  const aspectRatio = FORMAT_TO_ASPECT[fmt] || '1:1';

  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({
    model: photo ? REMIX_MODEL : FAL_MODEL, prompt, aspectRatio, slot,
    productId: product.id || product.sku || product.title,
    productPhoto: photo?.src || null,
    logoKey: logoKey || null,
  })).digest('hex');
  const cachedFilename = `cr_flux_cache_${cacheKey}.jpg`;
  const cachedPath = path.join(UPLOADS_DIR, cachedFilename);
  try {
    await fs.access(cachedPath);
    return { url: `/uploads/${cachedFilename}`, thumbnail: `/uploads/${cachedFilename}`, style: 'flux', language: options.language || 'fr', prompt, slot, cached: true,
      model: photo ? REMIX_MODEL : FAL_MODEL, cost_usd: 0, fal_requests: [] };
  } catch { /* cache miss */ }

  const FLUX_SIZE = {
    '1:1': { width: 1024, height: 1024 }, '4:5': { width: 1024, height: 1280 }, '9:16': { width: 720, height: 1280 },
    '3:2': { width: 1536, height: 1024 }, '2:3': { width: 1024, height: 1536 }, '16:9': { width: 1280, height: 720 },
  };
  // Every request is recorded; a failed one costs 0 because fal.ai bills only successful outputs (fal-pricing.js).
  const falRequests = [];
  const billed = async (model, body, size) => {
    try {
      const url = await callFal(key, model, body);
      falRequests.push({ model, ok: true, cost_usd: falOutputCost(model, size) });
      return url;
    } catch (e) {
      falRequests.push({ model, ok: false, cost_usd: 0 });
      throw e;
    }
  };
  const fluxSize = FLUX_SIZE[aspectRatio] || { width: 1024, height: 1024 };
  const textToImage = () => billed(FAL_MODEL, IS_FLUX
    ? { prompt, image_size: fluxSize, num_images: 1, enable_safety_checker: false }
    : { prompt, aspect_ratio: aspectRatio, style_type: 'DESIGN', magic_prompt_option: 'OFF', negative_prompt: 'blurry, low quality, watermark, ugly typography, misspelled text' },
  IS_FLUX ? fluxSize : null);

  let imageUrl;
  let model = FAL_MODEL;
  if (photo) {
    try {
      imageUrl = await billed(REMIX_MODEL, { prompt, image_url: photo.image_url, aspect_ratio: aspectRatio, strength: 0.65, style: 'design', enable_safety_checker: false });
      model = REMIX_MODEL;
    } catch (e) {
      console.error('[flux] remix failed, falling back to text-to-image:', e.message);
      imageUrl = await textToImage();
    }
  } else {
    imageUrl = await textToImage();
  }

  try {
    return await saveFalImage(imageUrl, { logoKey, cachedPath, options, prompt, slot, model, falRequests });
  } catch (e) {
    // fal.ai already billed the output; keep the cost on the failed creative.
    throw Object.assign(e, { model, cost_usd: totalCost(falRequests), fal_requests: falRequests });
  }
}

async function saveFalImage(imageUrl, { logoKey, cachedPath, options, prompt, slot, model, falRequests }) {
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`Ошибка загрузки изображения с fal.ai: ${imgRes.status}`);
  let imgBuf = Buffer.from(await imgRes.arrayBuffer());

  if (logoKey) imgBuf = await compositeLogoOnImage(imgBuf, logoKey);

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `cr_flux_${nanoid(16)}.jpg`;
  const thumbname = `thumb_${filename}`;

  await Promise.all([
    fs.writeFile(path.join(UPLOADS_DIR, filename), imgBuf),
    fs.writeFile(path.join(UPLOADS_DIR, thumbname), imgBuf),
    fs.writeFile(cachedPath, imgBuf),
  ]);

  return {
    url: `/uploads/${filename}`,
    thumbnail: `/uploads/${thumbname}`,
    style: 'flux',
    language: options.language || 'fr',
    prompt,
    slot,
    model,
    cost_usd: totalCost(falRequests),
    fal_requests: falRequests,
  };
}
