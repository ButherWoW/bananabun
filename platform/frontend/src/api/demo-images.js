// Demo build only: placeholder pictures for the made-up products and creatives.
// vite.config.js writes them into dist-demo/uploads/demo/, so the demo needs no external image host.

export const DEMO_PRODUCTS = [
  { key: 'lamp', label: 'LAMPE', bg: ['#1e3a5f', '#0f766e'], fg: '#fde68a' },
  { key: 'drawer', label: 'TIROIR', bg: ['#3f2d1d', '#a16207'], fg: '#fef3c7' },
  { key: 'chopper', label: 'HACHOIR', bg: ['#312e81', '#6d28d9'], fg: '#e0e7ff' },
  { key: 'yoga', label: 'YOGA', bg: ['#134e4a', '#16a34a'], fg: '#dcfce7' },
  { key: 'brush', label: 'BBQ', bg: ['#450a0a', '#c2410c'], fg: '#ffedd5' },
  { key: 'pillow', label: 'COUSSIN', bg: ['#1e1b4b', '#4338ca'], fg: '#e0e7ff' },
  { key: 'kettle', label: 'BOUILLOIRE', bg: ['#0c4a6e', '#0284c7'], fg: '#e0f2fe' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function productSvg({ label, bg, fg }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
<circle cx="300" cy="260" r="130" fill="${fg}" opacity="0.18"/>
<rect x="210" y="170" width="180" height="180" rx="28" fill="${fg}" opacity="0.85"/>
<text x="300" y="440" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="${fg}">${esc(label)}</text>
<text x="300" y="560" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" letter-spacing="8" fill="${fg}" opacity="0.7">DEMO</text>
</svg>`;
}

function creativeSvg({ label, bg, fg }, style, headline) {
  const dark = style === 1;
  const back = dark ? '#0b0b12' : bg[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${back}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/>
<rect x="290" y="250" width="500" height="500" rx="60" fill="${fg}" opacity="${dark ? 0.9 : 0.75}"/>
<text x="540" y="545" text-anchor="middle" font-family="Arial, sans-serif" font-size="70" font-weight="700" fill="${bg[0]}">${esc(label)}</text>
<text x="540" y="160" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${esc(headline)}</text>
<circle cx="900" cy="880" r="120" fill="#ef4444"/>
<text x="900" y="905" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="800" fill="#ffffff">-50%</text>
<text x="80" y="1010" font-family="Arial, sans-serif" font-size="34" letter-spacing="10" fill="#ffffff" opacity="0.6">DEMO</text>
</svg>`;
}

const HEADLINES = ['OFFRE DU JOUR', 'STOCK LIMITÉ', 'LIVRAISON OFFERTE'];

// { 'uploads/demo/product-1.svg': '<svg…>', 'uploads/demo/creative-1-2.svg': … }
export function demoImageFiles() {
  const files = {};
  DEMO_PRODUCTS.forEach((p, i) => {
    files[`uploads/demo/product-${i + 1}.svg`] = productSvg(p);
    HEADLINES.forEach((h, s) => { files[`uploads/demo/creative-${i + 1}-${s + 1}.svg`] = creativeSvg(p, s, h); });
  });
  return files;
}
