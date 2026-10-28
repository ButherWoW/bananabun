import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';

const FAL_BASE = 'https://fal.run';
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

const FORMAT_TO_FAL = {
  '1x1': 'square_hd',
  '4x5': 'portrait_4_3',
  '9x16': 'portrait_16_9',
  '3x2': 'landscape_4_3',
  '16x9': 'landscape_16_9',
};

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

// Scene templates for visual diversity — each slot gets a different composition
const SCENE_TEMPLATES = [
  // 0: Hero product on clean background
  (product, lang) => `Place the ${product} as the hero product centered on a clean, modern background with soft studio lighting; keep composition uncluttered with clear space in the upper area for a logo badge. Use high contrast lighting to make product details pop.`,
  // 1: Lifestyle in use
  (product, lang) => `Show the ${product} in a lifestyle setting — in use in a real home environment, warm natural light, inviting atmosphere; leave a clear area in a corner for logo. Scene should feel authentic and aspirational.`,
  // 2: Dark dramatic
  (product, lang) => `Create a dramatic close-up of the ${product} against a deep jewel-toned dark background (navy or charcoal); crisp, high-contrast lighting; reserve a clear bright area for a logo in the top corner.`,
  // 3: Bright airy pastel
  (product, lang) => `Show the ${product} in a bright, airy composition on a pale pastel or white background; fresh minimalist feel, soft shadows; leave a clean zone in the upper-left corner for logo placement.`,
  // 4: Detail feature shot
  (product, lang) => `Create a close-up detail shot highlighting key features of the ${product}; use a contrasting backdrop that complements the product color; reserve a clearly separated area for logo badge.`,
];

const CTAS = {
  fr: ['J\'en profite', 'Découvrir', 'Commander', 'Voir l\'offre', 'Je commande'],
  es: ['Lo quiero', 'Ver oferta', 'Comprar', 'Aprovechar', 'Pedir ahora'],
  en: ['Shop now', 'Order now', 'Get it', 'Buy now', 'See offer'],
  de: ['Jetzt kaufen', 'Entdecken', 'Bestellen', 'Angebot sehen', 'Kaufen'],
  it: ['Acquista ora', 'Scopri', 'Ordina', 'Vedi offerta', 'Approfitta'],
  pt: ['Comprar agora', 'Ver oferta', 'Pedir', 'Aproveitar', 'Descobrir'],
};

const HEADLINES = {
  fr: ['Offre limitée', 'Promotion exclusive', 'Prix imbattable', 'Super affaire', 'Vente flash'],
  es: ['Oferta limitada', 'Promoción exclusiva', 'Precio imbatible', 'Gran oferta', 'Venta flash'],
  en: ['Limited offer', 'Exclusive deal', 'Unbeatable price', 'Great deal', 'Flash sale'],
  de: ['Begrenzte Zeit', 'Exklusives Angebot', 'Unschlagbarer Preis', 'Top-Angebot', 'Flash-Sale'],
  it: ['Offerta limitata', 'Promozione esclusiva', 'Prezzo imbattibile', 'Affare top', 'Svendita flash'],
  pt: ['Oferta limitada', 'Promoção exclusiva', 'Preço imbatível', 'Ótima oferta', 'Liquidação'],
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
  const headlineText = headline || headlines[slot % headlines.length];
  const pct = oldPrice && newPrice ? discountPct(oldPrice, newPrice) : null;

  // Build the visual scene direction
  const scene = SCENE_TEMPLATES[slot % SCENE_TEMPLATES.length](title, lang);

  // Price text block
  const priceBlock = [
    oldPrice ? `crossed-out « ${oldPrice} ${currSign} »` : null,
    newPrice ? `large bold « ${newPrice} ${currSign} »` : null,
    pct ? `bold badge « ${pct} »` : null,
  ].filter(Boolean).join(', ');

  // French/target-language text instruction
  const textItems = [
    `headline « ${headlineText} »`,
    subline ? `subline « ${subline} »` : null,
    priceBlock || null,
    `CTA button « ${cta} »`,
  ].filter(Boolean).join(', ');

  const langName = { fr: 'French', es: 'Spanish', en: 'English', de: 'German', it: 'Italian', pt: 'Portuguese' }[lang] || 'French';

  return `${scene} Add ${langName} text only: ${textItems}; render every price and figure exactly as written, make the discount visually unmissable with strong color contrast on the price badge. The overall composition should be a polished, professional Facebook ad.`;
}

export function buildPrompt(product, slot = 0, options = {}) {
  return buildDirection(product, slot, options);
}

export function fluxEnabled() {
  return !!process.env.FAL_API_KEY;
}

export async function generateFluxCreative(product, _logoKey, format = '1x1', options = {}, slot = 0) {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_API_KEY не настроен');

  const prompt = buildPrompt(product, slot, options);
  const imageSize = FORMAT_TO_FAL[String(format).replace(':', 'x')] || 'square_hd';

  const falRes = await fetch(`${FAL_BASE}/fal-ai/flux/schnell`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: imageSize,
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!falRes.ok) {
    const errText = await falRes.text().catch(() => '');
    throw new Error(`fal.ai ${falRes.status}: ${errText.slice(0, 300)}`);
  }

  const data = await falRes.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai не вернул изображение');

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`Ошибка загрузки изображения с fal.ai: ${imgRes.status}`);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `cr_flux_${nanoid(16)}.jpg`;
  const thumbname = `thumb_${filename}`;

  await Promise.all([
    fs.writeFile(path.join(UPLOADS_DIR, filename), imgBuf),
    fs.writeFile(path.join(UPLOADS_DIR, thumbname), imgBuf),
  ]);

  return {
    url: `/uploads/${filename}`,
    thumbnail: `/uploads/${thumbname}`,
    style: 'flux',
    language: options.language || 'fr',
    prompt,
    slot,
  };
}
