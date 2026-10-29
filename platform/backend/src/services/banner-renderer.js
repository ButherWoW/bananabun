/**
 * Server-side banner renderer using sharp + SVG overlay.
 * Produces FA-style ad creatives: product photo + dark gradient + text/price/CTA.
 * No browser required — runs in milliseconds.
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Format → pixel size
const FORMAT_SIZE = {
  '1x1':  { w: 1080, h: 1080 },
  '4x5':  { w: 1080, h: 1350 },
  '9x16': { w: 1080, h: 1920 },
  '3x2':  { w: 1200, h: 800  },
  '16x9': { w: 1280, h: 720  },
};

const LANG_FONT = 'Arial, Helvetica, sans-serif';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

function discountPct(oldPrice, newPrice) {
  const o = parseFloat(oldPrice), n = parseFloat(newPrice);
  if (!o || !n || o <= n) return null;
  return `-${Math.round((1 - n / o) * 100)}%`;
}

const CTA_LABELS = {
  fr: "J'en profite", es: 'Lo quiero', en: 'Shop now',
  de: 'Jetzt kaufen', it: 'Acquista ora', pt: 'Comprar agora',
};

// Gradient backgrounds — varied per slot
const GRADIENTS = [
  ['#0d1b2a', '#1a3a5c'],  // deep navy
  ['#1a0a2e', '#3d1a6e'],  // dark purple
  ['#0a1628', '#1e3a5f'],  // midnight blue
  ['#1c1c1c', '#2d2d2d'],  // charcoal
  ['#0d2137', '#1a4a6e'],  // steel blue
];

function buildSVG(w, h, slot, data) {
  const {
    title, specs, newPrice, oldPrice, currency, cta, headline,
    pct,
  } = data;

  const [bg1, bg2] = GRADIENTS[slot % GRADIENTS.length];
  const isPortrait = h >= w;

  // Layout constants
  const pad = Math.round(w * 0.05);
  const titleSize = Math.round(w * 0.052);
  const specSize  = Math.round(w * 0.032);
  const priceSize = Math.round(w * 0.072);
  const oldPriceSize = Math.round(w * 0.038);
  const ctaH = Math.round(h * 0.065);
  const ctaW = Math.round(w * 0.38);

  // Title — wrap at ~20 chars per line
  const titleWords = esc(title).split(' ');
  const titleLines = [];
  let line = '';
  for (const w2 of titleWords) {
    if ((line + ' ' + w2).length > 22 && line) { titleLines.push(line); line = w2; }
    else line = line ? line + ' ' + w2 : w2;
  }
  if (line) titleLines.push(line);
  const titleLinesEl = titleLines.slice(0, 3).map((l, i) =>
    `<tspan x="${pad}" dy="${i === 0 ? 0 : titleSize * 1.25}">${l}</tspan>`
  ).join('');

  // Specs bullets (max 4)
  const specItems = specs.slice(0, 4);
  const specsStartY = Math.round(h * (isPortrait ? 0.30 : 0.32));
  const specsEl = specItems.map((s, i) => {
    const y = specsStartY + i * Math.round(h * 0.072);
    return `
      <circle cx="${pad + 10}" cy="${y - 6}" r="8" fill="#3b82f6" opacity="0.9"/>
      <text x="${pad + 26}" y="${y}" font-size="${specSize}" fill="#e2e8f0" font-family="${LANG_FONT}">${esc(String(s).slice(0, 40))}</text>`;
  }).join('');

  // Price block
  const priceY = Math.round(h * (isPortrait ? 0.72 : 0.74));
  const priceEl = `
    ${oldPrice ? `
      <text x="${pad}" y="${priceY - Math.round(h * 0.042)}" font-size="${oldPriceSize}" fill="#94a3b8"
        font-family="${LANG_FONT}" text-decoration="line-through">${esc(oldPrice)} ${esc(currency)}</text>` : ''}
    ${newPrice ? `
      <text x="${pad}" y="${priceY}" font-size="${priceSize}" fill="#22c55e" font-weight="bold"
        font-family="${LANG_FONT}">${esc(newPrice)} ${esc(currency)}</text>` : ''}
    ${pct ? `
      <rect x="${pad + Math.round(w * 0.36)}" y="${priceY - Math.round(h * 0.062)}" rx="6" ry="6"
        width="${Math.round(w * 0.18)}" height="${Math.round(h * 0.068)}" fill="#ef4444"/>
      <text x="${pad + Math.round(w * 0.37)}" y="${priceY - Math.round(h * 0.018)}"
        font-size="${Math.round(w * 0.042)}" fill="white" font-weight="bold" font-family="${LANG_FONT}">${esc(pct)}</text>` : ''}`;

  // CTA button
  const ctaY = Math.round(h * 0.84);
  const ctaEl = `
    <rect x="${pad}" y="${ctaY}" rx="8" ry="8" width="${ctaW}" height="${ctaH}" fill="#2563eb"/>
    <text x="${pad + ctaW / 2}" y="${ctaY + ctaH * 0.64}" text-anchor="middle"
      font-size="${Math.round(ctaH * 0.44)}" fill="white" font-weight="bold" font-family="${LANG_FONT}">${esc(cta)} ›</text>`;

  // Headline above title
  const headlineEl = headline ? `
    <rect x="${pad}" y="${Math.round(h * 0.06)}" rx="4" ry="4"
      width="${Math.round(w * 0.32)}" height="${Math.round(h * 0.038)}" fill="#3b82f6" opacity="0.85"/>
    <text x="${pad + 8}" y="${Math.round(h * 0.087)}"
      font-size="${Math.round(h * 0.024)}" fill="white" font-family="${LANG_FONT}">${esc(String(headline).slice(0, 28).toUpperCase())}</text>` : '';

  // Title text block
  const titleY = Math.round(h * (headline ? 0.145 : 0.11));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
    <linearGradient id="overlay" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${bg1}" stop-opacity="0.97"/>
      <stop offset="${isPortrait ? 100 : 55}%" stop-color="${bg1}" stop-opacity="${isPortrait ? 0.3 : 0.0}"/>
    </linearGradient>
    <clipPath id="clip"><rect width="${w}" height="${h}" rx="0"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="${w}" height="${h}" fill="url(#bg)"/>

  <!-- Left text overlay (covers product photo partially in landscape) -->
  <rect width="${w}" height="${h}" fill="url(#overlay)"/>

  ${headlineEl}

  <!-- Title -->
  <text x="${pad}" y="${titleY}" font-size="${titleSize}" fill="white" font-weight="bold"
    font-family="${LANG_FONT}" dominant-baseline="hanging">${titleLinesEl}</text>

  ${specsEl}
  ${priceEl}
  ${ctaEl}
</svg>`;
}

/**
 * Download a URL to buffer, with timeout.
 */
async function fetchBuffer(url, timeoutMs = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Load product image: try each URL in the images array, return buffer or null.
 */
async function loadProductImage(product) {
  const images = asArray(product.images);
  const externals = asArray(product.external_images);
  const candidates = [...images, ...externals].filter(Boolean);
  for (const src of candidates.slice(0, 3)) {
    try {
      if (/^https?:\/\//.test(src)) return await fetchBuffer(src);
      // Only allow files inside UPLOADS_DIR — reject any other local path.
      if (!src.startsWith('/uploads/')) continue;
      const rel = src.slice('/uploads/'.length);
      if (rel.includes('..') || path.isAbsolute(rel)) continue;
      return await fs.readFile(path.join(UPLOADS_DIR, rel));
    } catch { /* try next */ }
  }
  return null;
}

async function loadLogo(options = {}) {
  const key = options.logo_key;
  if (!key || !/^\/uploads\/logos\/logo_[A-Za-z0-9_-]{16}\.(jpg|jpeg|png|webp)$/.test(key)) return null;
  try { return await fs.readFile(path.join(UPLOADS_DIR, key.slice('/uploads/'.length))); } catch { return null; }
}

export async function renderBanner(product, format = '1x1', options = {}, slot = 0) {
  const fmt = String(format).replace(':', 'x');
  const { w, h } = FORMAT_SIZE[fmt] || FORMAT_SIZE['1x1'];
  const { language = 'fr', headline, landing_price } = options;
  const lang = language in CTA_LABELS ? language : 'fr';

  const bundles = asArray(product.bundle_config);
  const bundle = bundles[0] || {};
  const newPrice = landing_price || bundle.price || product.source_price;
  const oldPrice = bundle.old_price || null;
  const currency = bundle.currency === 'GBP' ? '£' : bundle.currency === 'USD' ? '$' : '€';
  const pct = oldPrice && newPrice ? discountPct(oldPrice, newPrice) : null;
  const cta = CTA_LABELS[lang];

  // Specs from product
  const specs = asArray(product.specs)
    .map(s => [s.label, s.value].filter(Boolean).join(': '))
    .filter(Boolean);

  const title = (product.title || 'Product').slice(0, 120);

  // 1. Create base: gradient background sized to format
  const isPortrait = h >= w;
  let base = sharp({
    create: { width: w, height: h, channels: 4, background: { r: 13, g: 27, b: 42, alpha: 1 } },
  });

  const composites = [];

  // Draw the designed background/text first; the real product photo then sits above
  // the background on the visual side, while the text remains readable on the left.
  const svgData = buildSVG(w, h, slot, {
    title, specs, newPrice, oldPrice, currency, cta,
    headline: headline || null, pct,
  });
  composites.push({ input: Buffer.from(svgData), left: 0, top: 0, blend: 'over' });

  // 2. Product image — right half in landscape, top in portrait
  const imgBuf = await loadProductImage(product);
  if (imgBuf) {
    try {
      const imgW = isPortrait ? Math.round(w * 0.85) : Math.round(w * 0.58);
      const imgH = isPortrait ? Math.round(h * 0.45) : Math.round(h * 0.82);
      const left = isPortrait ? Math.round((w - imgW) / 2) : w - imgW;
      const top  = isPortrait ? Math.round(h * 0.10) : Math.round((h - imgH) / 2);

      const resized = await sharp(imgBuf)
        .resize(imgW, imgH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      composites.push({ input: resized, left, top, blend: 'over' });
    } catch { /* skip if image broken */ }
  }

  const logo = await loadLogo(options);
  if (logo) {
    const logoBuf = await sharp(logo).resize(Math.round(w * 0.18), Math.round(h * 0.10), { fit: 'contain' }).png().toBuffer();
    composites.push({ input: logoBuf, left: Math.round(w * 0.05), top: Math.round(h * 0.035), blend: 'over' });
  }

  // 4. Composite everything
  const outBuf = await base.composite(composites).jpeg({ quality: 90 }).toBuffer();

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename  = `cr_banner_${nanoid(16)}.jpg`;
  const thumbname = `thumb_${filename}`;

  await Promise.all([
    fs.writeFile(path.join(UPLOADS_DIR, filename), outBuf),
    // Thumbnail — 400px wide
    sharp(outBuf).resize(400).jpeg({ quality: 80 }).toFile(path.join(UPLOADS_DIR, thumbname)),
  ]);

  return {
    url: `/uploads/${filename}`,
    thumbnail: `/uploads/${thumbname}`,
    style: 'banner',
    language: lang,
  };
}
