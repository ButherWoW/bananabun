import { db } from '../db/client.js';
import { keitaroClient } from './keitaro.js';
import { enqueueAgentJob, waitAgentJobDone } from '../api/routes/agent.js';

// «Похожие на продающие»: products that brought Keitaro sales in the period are the samples;
// for each one the Mac agent searches Amazon in the scrape profile. Candidates similar to what
// sells in the push geo come first, then by number of reviews. Nothing is scraped automatically:
// the human picks candidates and scrapes them.

const DOMAINS = { fr: 'amazon.fr', es: 'amazon.es', de: 'amazon.de', it: 'amazon.it', uk: 'amazon.co.uk', com: 'amazon.com', nl: 'amazon.nl', pl: 'amazon.pl', be: 'amazon.com.be', se: 'amazon.se' };
const GEO_STORE = { FR: 'fr', ES: 'es', DE: 'de', IT: 'it', GB: 'uk', UK: 'uk', NL: 'nl', PL: 'pl', BE: 'be', SE: 'se', AT: 'de', CH: 'de', PT: 'es' };
const STOP = new Set(['avec', 'pour', 'sans', 'pack', 'lot', 'de', 'des', 'les', 'la', 'le', 'et', 'en', 'con', 'para', 'por', 'und', 'mit', 'für', 'the', 'and', 'with', 'for', 'per', 'di', 'da', 'il', 'cm', 'mm', 'kg', 'w', 'v']);

// Search words from a product title: the first meaningful words, without sizes and filler.
export function queryOf(title) {
  const words = String(title || '').toLowerCase().replace(/[()[\]{},.;:!?/\\|+*"«»]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w) && !/^\d/.test(w));
  return words.slice(0, 5).join(' ');
}

// One Amazon search page through the Mac agent (scrape profile). Returns the cards as Amazon shows them.
export async function searchViaAgent(user, store, query, minPrice, maxPrice) {
  if (!DOMAINS[store]) throw new Error(`Неизвестная витрина Amazon: ${store}`);
  let url = `https://www.${DOMAINS[store]}/s?k=${encodeURIComponent(String(query).slice(0, 200))}`;
  if (minPrice) url += `&low-price=${Number(minPrice)}`;
  if (maxPrice) url += `&high-price=${Number(maxPrice)}`;
  const jobId = await enqueueAgentJob(user.ws, 'search_amazon', { url }, user.id);
  const data = await waitAgentJobDone(user.ws, jobId, 180000);
  return (data?.items || []).map(it => ({ ...it, marketplace: store, url: `https://www.${DOMAINS[store]}/dp/${it.asin}` }));
}

// Product words from a campaign name: without the [buyer] tag, status suffixes and dates; null when random.
export function productFromName(name) {
  const t = String(name || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s[-–—|]\s.*$/, ' ')
    .replace(/\b\d{1,2}[./]\d{1,2}([./]\d{2,4})?\b/g, ' ').replace(/\s+/g, ' ').trim();
  // Random names are one token (sq7n2c6d5t); a product name has a space and a real word in any alphabet.
  return t.includes(' ') && t.length >= 8 && t.split(' ').some(w => /\p{L}{4,}/u.test(w)) ? t.slice(0, 120) : null;
}

export async function findSimilar(user, { geo, from, to, minPrice, maxPrice, marketplace, minReviews }) {
  const w = await db.findOne('workspaces', { id: user.ws });
  if (!w?.keitaro_url || !w?.keitaro_api_key) throw new Error('Keitaro не настроен');
  const store = marketplace || GEO_STORE[geo] || 'com';
  if (!DOMAINS[store]) throw new Error(`Неизвестная витрина Amazon: ${store}`);

  // Sales by FB campaign (sub_id_2) and visitor country.
  const report = await keitaroClient(w.keitaro_url, w.keitaro_api_key).stats({ from, to }, ['sub_id_2', 'country'], ['sales']);
  const sold = new Map(); // campaign -> { total, geo }
  for (const r of report?.rows || []) {
    const id = String(r.sub_id_2 || '');
    const n = Number(r.sales) || 0;
    if (!/^\d+$/.test(id) || !n) continue;
    const s = sold.get(id) || { total: 0, geo: 0 };
    s.total += n;
    if (String(r.country || r.country_code || '').toUpperCase() === geo) s.geo += n;
    sold.set(id, s);
  }
  if (!sold.size) return { samples: [], items: [], note: 'За период нет продаж в Keitaro — образцов нет' };

  // Campaign → product through our pushes; buyers only see their own.
  const { rows } = await db.query(`
    SELECT p.fb_campaign_id, pr.id, pr.title, pr.source_id
      FROM pushes p JOIN products pr ON pr.id = p.product_id
     WHERE p.workspace_id = $1 AND p.fb_campaign_id = ANY($2) AND ($3::text IS NULL OR p.created_by = $3)`,
    [user.ws, [...sold.keys()], user.role === 'buyer' ? user.id : null]);
  const byProduct = new Map();
  for (const r of rows) {
    const s = sold.get(String(r.fb_campaign_id));
    const cur = byProduct.get(r.id) || { id: r.id, title: r.title, asin: r.source_id, sales: 0, geo_sales: 0 };
    cur.sales += s.total; cur.geo_sales += s.geo;
    byProduct.set(r.id, cur);
  }
  // Campaigns not pushed by the platform: the product is taken from the campaign name when it reads
  // like one («[yanix] GT Garden Tronçonneuse 62cc - НОВЫЙ»); random names (sq7n2c6d5t) are skipped.
  const pushed = new Set(rows.map(r => String(r.fb_campaign_id)));
  const group = user.role === 'buyer' ? String(user.email || '').toLowerCase() : null;
  const { rows: named } = await db.query(`
    SELECT c.id, c.name FROM fb_campaigns c JOIN fb_accounts fa ON fa.id = c.fb_account_id
      LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE c.workspace_id = $1 AND c.id = ANY($2) AND ($3::text IS NULL OR LOWER(ap.group_name) = $3)`,
    [user.ws, [...sold.keys()].filter(id => !pushed.has(id)), group]);
  for (const c of named) {
    const title = productFromName(c.name);
    if (!title) continue;
    const s = sold.get(String(c.id));
    const key = `name:${title.toLowerCase()}`;
    const cur = byProduct.get(key) || { id: null, title, asin: null, sales: 0, geo_sales: 0, from_name: true };
    cur.sales += s.total; cur.geo_sales += s.geo;
    byProduct.set(key, cur);
  }
  const samples = [...byProduct.values()].sort((a, b) => b.geo_sales - a.geo_sales || b.sales - a.sales).slice(0, 10);
  if (!samples.length) {
    return { samples: [], items: [], note: `Продажи есть (${sold.size} кампаний), но ни по одной не определить товар: они не залиты платформой и названы не по товару` };
  }

  const { rows: mine } = await db.query(`SELECT source_id FROM products WHERE workspace_id = $1 AND source_id IS NOT NULL`, [user.ws]);
  const known = new Set(mine.map(r => String(r.source_id)));
  const items = new Map();
  const errors = [];
  for (const s of samples) {
    const q = queryOf(s.title);
    if (!q) continue;
    try {
      for (const it of await searchViaAgent(user, store, q, minPrice, maxPrice)) {
        if (!it.asin || known.has(it.asin) || samples.some(x => x.asin === it.asin) || items.has(it.asin)) continue;
        if (minPrice && it.price != null && it.price < Number(minPrice)) continue;
        if (maxPrice && it.price != null && it.price > Number(maxPrice)) continue;
        if (minReviews && (it.reviews_count || 0) < Number(minReviews)) continue;
        items.set(it.asin, { ...it, sample: s.title, query: q, geo_sales: s.geo_sales > 0 });
      }
    } catch (e) {
      errors.push(`«${q}»: ${e.message}`);
      if (/робот/i.test(e.message)) break; // a robot check stops everything until a human passes it
    }
  }
  const list = [...items.values()].sort((a, b) => Number(b.geo_sales) - Number(a.geo_sales) || (b.reviews_count || 0) - (a.reviews_count || 0));
  return { samples, items: list, total: list.length, marketplace: store, errors };
}
