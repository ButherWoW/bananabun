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

function buildPrompt(product, options = {}) {
  const { language = 'fr', headline, landing_price } = options;
  const title = (product.title || 'Product').slice(0, 120);
  const bundles = asArray(product.bundle_config);
  const price = landing_price || bundles[0]?.price || product.source_price;
  const oldPrice = bundles[0]?.old_price;

  const ctas = { fr: 'Commandez maintenant', es: 'Compra ahora', en: 'Order now', de: 'Jetzt kaufen', it: 'Ordina ora', pt: 'Compre agora' };
  const cta = ctas[language] || ctas.en;

  const parts = [
    `Professional e-commerce Facebook advertisement for product "${title}".`,
    'Product shown prominently in center, photorealistic, high quality.',
    price ? `Bold price badge showing ${price}в‚¬${oldPrice ? ` (crossed out original ${oldPrice}в‚¬)` : ''}.` : '',
    `Call-to-action text: "${headline || cta}".`,
    'Clean modern ad design, vibrant gradient background, high contrast typography, mobile-optimized social media format.',
  ].filter(Boolean);

  return parts.join(' ');
}

export function fluxEnabled() {
  return !!process.env.FAL_API_KEY;
}

export async function generateFluxCreative(product, _logoKey, format = '1x1', options = {}) {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_API_KEY РЅРµ РЅР°СЃС‚СЂРѕРµРЅ');

  const prompt = buildPrompt(product, options);
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
  if (!imageUrl) throw new Error('fal.ai РЅРµ РІРµСЂРЅСѓР» РёР·РѕР±СЂР°Р¶РµРЅРёРµ');

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РёР·РѕР±СЂР°Р¶РµРЅРёСЏ СЃ fal.ai: ${imgRes.status}`);
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
  };
}
