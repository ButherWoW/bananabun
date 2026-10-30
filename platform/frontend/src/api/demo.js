import { AxiosError } from 'axios';

// Demo build only (vite build --mode demo). Every API call of the panel is answered here, in the
// browser: reads get made-up fixtures in the shape the backend returns, every change is refused.
// Nothing in this file may ever come from production data: no real cabinets, tokens or people.

export const DENIED = 'Хуй тебе';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const DAY = 86400000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const ymd = (msAgo = 0) => new Date(now - msAgo).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
// Stable pseudo-random numbers: the same page shows the same figures on every visit.
const noise = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

// ─── People and workspace ─────────────────────────────────────────────────────

const USER = { id: 'usr_demo_owner', name: 'Demo Owner', email: 'owner@demo.invalid', role: 'owner', keitaro_tag: 'demo' };
const WORKSPACE = { id: 'ws_demo', name: 'Demo Workspace' };
const PEOPLE = [
  { ...USER, created_at: iso(120 * DAY) },
  { id: 'usr_demo_lead', name: 'Demo Lead', email: 'lead@demo.invalid', role: 'lead', keitaro_tag: 'lead', created_at: iso(90 * DAY) },
  { id: 'usr_demo_b1', name: 'Demo Buyer 1', email: 'buyer1@demo.invalid', role: 'buyer', keitaro_tag: 'buyer1', created_at: iso(60 * DAY) },
  { id: 'usr_demo_b2', name: 'Demo Buyer 2', email: 'buyer2@demo.invalid', role: 'buyer', keitaro_tag: 'buyer2', created_at: iso(30 * DAY) },
];

// ─── Products ─────────────────────────────────────────────────────────────────

const FOLDERS = [
  { id: 'fld_demo_kitchen', name: 'Кухня', shared: false },
  { id: 'fld_demo_garden', name: 'Сад и дача', shared: false },
  { id: 'fld_demo_tests', name: 'Тесты FR', shared: true },
];

const img = (n) => `/uploads/demo/product-${n}.svg`;
const bundles = (price, offer) => [
  { qty: '1', old_price: r2(price * 1.6).toFixed(2), price: price.toFixed(2), currency: 'EUR', offer_id: offer },
  { qty: '2+1', old_price: r2(price * 3.2).toFixed(2), price: r2(price * 1.8).toFixed(2), currency: 'EUR', offer_id: offer + 1 },
];

const PRODUCTS = [
  { n: 1, title: 'Lampe solaire LED pour jardin, lot de 4 — DemoHome', folder: 'fld_demo_garden', price: 34.9, offer: 9001,
    description: 'Lampes solaires étanches IP65, allumage automatique au crépuscule, jusqu’à 10 h d’éclairage.',
    specs: [['Puissance', '2 W'], ['Autonomie', '10 h'], ['Indice', 'IP65']] },
  { n: 2, title: 'Organiseur de tiroir en bambou extensible — DemoHome', folder: 'fld_demo_kitchen', price: 24.9, offer: 9003,
    description: 'Range-couverts en bambou naturel, 7 compartiments, largeur réglable de 33 à 53 cm.',
    specs: [['Matière', 'Bambou'], ['Compartiments', '7']] },
  { n: 3, title: 'Mini hachoir électrique sans fil 250 ml — DemoKitchen', folder: 'fld_demo_kitchen', price: 29.9, offer: 9001,
    description: 'Hachoir rechargeable USB-C pour ail, oignons et herbes, lames en acier inoxydable.',
    specs: [['Capacité', '250 ml'], ['Batterie', '1200 mAh']] },
  { n: 4, title: 'Tapis de yoga antidérapant 6 mm avec sangle — DemoFit', folder: 'fld_demo_tests', price: 27.9, offer: 9003,
    description: 'Tapis épais et léger, surface antidérapante double face, sangle de transport incluse.',
    specs: [['Épaisseur', '6 mm'], ['Dimensions', '183 × 61 cm']] },
  { n: 5, title: 'Brosse de nettoyage pour barbecue 3 en 1 — DemoGrill', folder: 'fld_demo_garden', price: 19.9, offer: 9001,
    description: 'Brosse sans poils métalliques, grattoir intégré, manche de 45 cm.',
    specs: [['Longueur', '45 cm']] },
  { n: 6, title: 'Coussin cervical à mémoire de forme — DemoSleep', folder: 'fld_demo_tests', price: 39.9, offer: 9003,
    description: 'Oreiller ergonomique, housse lavable en bambou, soutien de la nuque.',
    specs: [['Matière', 'Mousse à mémoire'], ['Housse', 'Bambou']] },
  { n: 7, title: 'Bouilloire pliable de voyage 600 ml — DemoTravel', folder: 'fld_demo_kitchen', price: 32.9, offer: 9001,
    description: 'Bouilloire en silicone alimentaire, se plie à 5 cm, double tension.',
    specs: [['Capacité', '600 ml'], ['Puissance', '600 W']] },
].map(p => ({
  id: `prd_demo_${p.n}`,
  title: p.title,
  description: p.description,
  specs: p.specs.map(([label, value]) => ({ label, value })),
  source: 'amazon',
  source_id: `DEMO00000${p.n}`,
  source_url: `https://shop.demo.invalid/item/DEMO00000${p.n}`,
  source_price: r2(p.price * 1.6).toFixed(2),
  source_currency: 'EUR',
  scrape_status: 'done',
  engine: 'own',
  images: [img(p.n)],
  images_count: 1,
  reviews_count: 3,
  bundle_config: bundles(p.price, p.offer),
  folder_id: p.folder,
  status: 'ready',
  tags: ['demo'],
  created_at: iso(p.n * 2 * DAY),
}));
PRODUCTS.push({
  id: 'prd_demo_8', title: '', description: '', specs: [], source: 'amazon', source_id: 'DEMO000008',
  source_url: 'https://shop.demo.invalid/item/DEMO000008', scrape_status: 'failed',
  scrape_error: 'Страница товара не открылась (демо-данные)', images: [], images_count: 0, reviews_count: 0,
  bundle_config: [], folder_id: null, status: 'draft', tags: [], created_at: iso(DAY / 2),
});

const REVIEWS = [
  { author: 'Camille R.', rating: 5, text: 'Très bon produit, conforme à la description. Livraison rapide.' },
  { author: 'Julien P.', rating: 4, text: 'Bonne qualité pour le prix, je recommande.' },
  { author: 'Sophie L.', rating: 5, text: 'Exactement ce que je cherchais, ma famille adore !' },
];

function productList(q) {
  let items = PRODUCTS;
  if (q.folder_id === 'none') items = items.filter(p => !p.folder_id);
  else if (q.folder_id) items = items.filter(p => p.folder_id === q.folder_id);
  if (q.scrape_status) items = items.filter(p => p.scrape_status === q.scrape_status);
  if (q.search) items = items.filter(p => (p.title || p.source_id).toLowerCase().includes(String(q.search).toLowerCase()));
  items = [...items].sort(q.sort === 'old' ? (a, b) => a.created_at.localeCompare(b.created_at)
    : q.sort === 'name' ? (a, b) => (a.title || '').localeCompare(b.title || '')
    : (a, b) => b.created_at.localeCompare(a.created_at));
  const limit = Number(q.limit) || 24;
  return { items: items.slice(0, limit), total: items.length, page: 1, limit };
}

// ─── Creatives ────────────────────────────────────────────────────────────────

const CREATIVES = [];
PRODUCTS.slice(0, 7).forEach((p, i) => {
  const n = i + 1;
  [1, 2, 3].slice(0, n <= 4 ? 3 : 1).forEach(s => CREATIVES.push({
    id: `cr_demo_${n}_${s}`, product_id: p.id, created_at: iso((n * 2 * DAY) - s * 3600000), status: 'done',
    type: 'image', format: s === 3 ? '2x3' : '1x1', file_url: `/uploads/demo/creative-${n}-${s}.svg`,
    favorite: s === 1 && n % 2 === 1,
    metadata: { language: n === 2 ? 'nl' : 'fr', name: ['Style clean', 'Style dark', 'Style gradient'][s - 1], source: 'local' },
  }));
});
CREATIVES.push({
  id: 'cr_demo_video_1', product_id: 'prd_demo_1', created_at: iso(DAY), status: 'done', type: 'video', format: '1x1',
  file_url: '/uploads/demo/creative-1-2.svg', thumbnail_url: '/uploads/demo/creative-1-2.svg', favorite: false,
  metadata: { language: 'fr', name: 'Слайдшоу (демо)', kind: 'video' },
});
CREATIVES.push({
  id: 'cr_demo_failed_1', product_id: 'prd_demo_3', created_at: iso(DAY / 3), status: 'failed', type: 'image', format: '1x1',
  file_url: null, favorite: false, metadata: { language: 'fr', error: 'У товара нет фото для шаблона (демо-ошибка)' },
});

// ─── Keitaro ──────────────────────────────────────────────────────────────────

const OFFERS = [
  { id: 9001, name: 'Demo Offer FR · 1 шт', state: 'active', price: 34.9, currency: 'EUR' },
  { id: 9002, name: 'Demo Offer FR · 2+1', state: 'active', price: 62.9, currency: 'EUR' },
  { id: 9003, name: 'Demo Offer BE · 1 шт', state: 'active', price: 29.9, currency: 'EUR' },
  { id: 9004, name: 'Demo Offer BE · 2+1', state: 'active', price: 53.9, currency: 'EUR' },
];
const KT_GROUPS = [
  { id: 501, name: 'Demo Group · FR', type: 'campaigns' },
  { id: 502, name: 'Demo Group · BE', type: 'campaigns' },
];
const KT_DOMAINS = [
  { id: 701, name: 'shop-demo-one.invalid', domain: 'shop-demo-one.invalid' },
  { id: 702, name: 'shop-demo-two.invalid', domain: 'shop-demo-two.invalid' },
];
const KT_LANDINGS = [
  { id: 801, name: 'Demo Store_fr', state: 'active' },
  { id: 802, name: 'Demo Store_be', state: 'active' },
  { id: 803, name: 'White Page_fr', state: 'active' },
  { id: 804, name: 'Demo Form Order_fr', state: 'active' },
  { id: 805, name: 'Demo Store_de', state: 'disabled' },
];
const KT_SETTINGS = {
  keitaro_url: 'https://tracker.demo.invalid', keitaro_api_key: '***',
  keitaro_domain_id: 701, keitaro_group_id: 501, keitaro_offer_ids: [9001, 9003], keitaro_white_id: 803,
};

// ─── Facebook campaigns (our list) ────────────────────────────────────────────

const CAB = [1, 2, 3].map(k => ({
  bm: `Demo BM ${k}`, bm_id: `bm_demo_${k}`, act_id: `act_demo_00${k}`, act_name: `Demo Cabinet ${k}`,
  page: `Demo Page ${k}`, page_id: `pg_demo_${k}`, profile: String(100 + k),
}));

// Today's FB spend and Keitaro revenue; other periods are scaled from it.
const CAMPAIGN_SEEDS = [
  { n: 1, p: 1, geo: 'FR', cab: 0, buyer: 'demo-buyer-1', fb: 'ACTIVE', spend: 84.2, revenue: 139.6, sales: 4 },
  { n: 2, p: 2, geo: 'BE', cab: 1, buyer: 'demo-buyer-2', fb: 'ACTIVE', spend: 46.5, revenue: 59.8, sales: 2 },
  { n: 3, p: 3, geo: 'FR', cab: 0, buyer: 'demo-buyer-1', fb: 'ACTIVE', spend: 31.7, revenue: 0, sales: 0 },
  { n: 4, p: 4, geo: 'FR', cab: 2, buyer: 'demo-buyer-2', fb: 'WITH_ISSUES', spend: 12.4, revenue: 27.9, sales: 1, rejected: 2 },
  { n: 5, p: 6, geo: 'DE', cab: 1, buyer: 'demo-buyer-1', fb: 'PAUSED', spend: 0, revenue: 0, sales: 0 },
  { n: 6, p: 7, geo: 'FR', cab: 2, buyer: 'demo-buyer-2', fb: 'PAUSED', spend: 0, revenue: 32.9, sales: 1 },
  { n: 7, p: 5, geo: 'FR', cab: 0, buyer: 'demo-buyer-1', fb: 'PAUSED', spend: 0, revenue: 0, sales: 0, archived: true },
  { n: 8, p: 1, geo: 'CH', cab: 1, buyer: 'demo-buyer-2', fb: 'ACTIVE', spend: 58.9, revenue: 104.7, sales: 3 },
];
const PERIOD_FACTOR = { today: 1, yesterday: 1.12, last_3_days: 3.3, last_7_days: 7.4, last_30_days: 29 };
const PERIOD_LABEL = { today: 'Сегодня', yesterday: 'Вчера', last_3_days: '3 дня', last_7_days: '7 дней', last_30_days: '30 дней' };
const ACCOUNT_STATUS = { 2: 'кабинет отключён', 3: 'долг по оплате в кабинете' };

const shortTitle = (p) => p.title.split(/[,—]/)[0].trim();

function fbCampaign(s, period = 'today') {
  const product = PRODUCTS[s.p - 1];
  const cab = CAB[s.cab];
  const f = PERIOD_FACTOR[period] || 1;
  // A paused campaign still has spend in the past periods.
  const base = s.spend || (s.archived ? 0 : 18 + s.n * 3);
  const spend = r2(s.fb === 'ACTIVE' || period === 'today' ? s.spend * f : base * (f - 1) * 0.9);
  const revenue = r2((s.revenue || (period === 'today' ? 0 : base * 1.3)) * f);
  const sales = Math.round((s.sales || (period === 'today' ? 0 : 1)) * f);
  const lp = Math.round((spend / 0.32) * (0.85 + noise(s.n) * 0.3));
  const created = now - (s.n * 3 + 2) * DAY;
  const dd = new Date(created).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const name = `[d${s.n}a${s.n}f][${dd}][${s.buyer}(u${s.cab + 1})][${shortTitle(product)}(${product.id})][${s.geo}][Demo Store(lt_demo_1)][#${cab.profile}][${cab.bm}(${cab.bm_id})][${cab.act_name}(${cab.act_id})][${cab.page}(${cab.page_id})]`;
  const moderation = { total: 6, rejected: s.rejected || 0, issues: 0 };
  const adsets = [1, 2, 3].map(a => {
    const on = s.fb === 'ACTIVE' || (s.fb === 'WITH_ISSUES' && a < 3);
    return {
      id: `as_demo_${s.n}_${a}`, name: `${s.geo} · ${a === 1 ? '25–65 все' : a === 2 ? '35–65 женщины' : '25–55 мужчины'}`,
      status: on ? 'ACTIVE' : 'PAUSED', effective_status: on ? 'ACTIVE' : 'PAUSED',
      daily_budget: 20, bid_amount: r2(1.1 + a * 0.15),
      audience: { age_min: a === 2 ? 35 : 25, age_max: a === 3 ? 55 : 65, genders: a === 1 ? 'all' : a === 2 ? 'female' : 'male', countries: [s.geo] },
      moderation: s.rejected && a === 3 ? { label: 'Отклонено объявлений: 2', rejected: 2, issues: 0 } : null,
      ads: [1, 2].map(k => {
        const rejected = s.rejected && a === 3;
        return {
          id: `ad_demo_${s.n}_${a}_${k}`, name: `Креатив ${k} · ${['clean', 'dark'][k - 1]}`,
          status: on ? 'ACTIVE' : 'PAUSED', effective_status: rejected ? 'DISAPPROVED' : on ? 'ACTIVE' : 'PAUSED',
          moderation: rejected
            ? { code: 'rejected', label: 'Отклонено', reason: 'Демо-причина: преувеличенные обещания в тексте' }
            : { code: 'approved', label: 'Одобрено' },
        };
      }),
    };
  });
  const attention = [];
  if (!s.archived) {
    if (s.account_status && ACCOUNT_STATUS[s.account_status]) attention.push(ACCOUNT_STATUS[s.account_status]);
    if (moderation.rejected) attention.push(`отклонено объявлений: ${moderation.rejected} из ${moderation.total}`);
    if (s.fb === 'WITH_ISSUES') attention.push('у кампании проблема в Facebook');
    if (s.fb === 'ACTIVE' && spend > 0 && revenue === 0) attention.push('есть расход, нет дохода');
    else if (s.fb === 'ACTIVE' && spend > 0 && (revenue - spend) / spend < -0.3) attention.push('ROI ниже −30 %');
  }
  return {
    id: `fbc_demo_${s.n}`, name, status: s.fb === 'PAUSED' ? 'PAUSED' : 'ACTIVE', effective_status: s.fb,
    act_id: cab.act_id, act_name: cab.act_name, currency: 'USD', account: `Demo Account ${s.cab + 1}`,
    profile: cab.profile, buyer: s.buyer, daily_budget: null, adsets,
    spend, lp_clicks: lp, leads: sales, sales, revenue,
    lp_cost: lp ? r2(spend / lp) : null, profit: r2(revenue - spend), roi: spend ? r2((revenue - spend) / spend * 100) : null,
    created_time: new Date(created).toISOString(), synced_at: iso(14 * 60000),
    moderation, account_status: 1, spend_cap: s.n === 1 ? 500 : null,
    archived: !!s.archived, archived_at: s.archived ? iso(2 * DAY) : null, attention,
    _product: product, _seed: s,
  };
}

const publicCampaign = ({ _product, _seed, ...c }) => c;

function landingFunnel(scale = 1, rows = TEMPLATE_FUNNEL) {
  const out = rows.map(r => {
    const views = Math.round(r.views * scale);
    const bundle_pick = Math.round(views * r.pick);
    const buy_click = Math.round(views * r.buy);
    const sales = Math.round(buy_click * 0.32);
    return { key: r.key, name: r.name, views, scroll_75: Math.round(views * 0.46), bundle_pick, buy_click, sales,
      pick_rate: views ? r2(bundle_pick / views * 100) : 0, buy_rate: views ? r2(buy_click / views * 100) : 0 };
  });
  const t = out.reduce((a, r) => ({ views: a.views + r.views, scroll_75: a.scroll_75 + r.scroll_75, bundle_pick: a.bundle_pick + r.bundle_pick, buy_click: a.buy_click + r.buy_click, sales: a.sales + r.sales }),
    { views: 0, scroll_75: 0, bundle_pick: 0, buy_click: 0, sales: 0 });
  t.pick_rate = t.views ? r2(t.bundle_pick / t.views * 100) : 0;
  t.buy_rate = t.views ? r2(t.buy_click / t.views * 100) : 0;
  return { totals: t, rows: out };
}
const TEMPLATE_FUNNEL = [
  { key: 'lt_demo_1', name: 'Demo Store', views: 1840, pick: 0.31, buy: 0.12 },
  { key: 'lt_demo_2', name: 'Demo Quiz', views: 960, pick: 0.38, buy: 0.15 },
  { key: 'lt_demo_3', name: 'Demo Form Order', views: 420, pick: 0.22, buy: 0.09 },
];

function fbSummary(id) {
  const seed = CAMPAIGN_SEEDS.find(s => `fbc_demo_${s.n}` === id) || CAMPAIGN_SEEDS[0];
  const c = fbCampaign(seed);
  const periods = Object.keys(PERIOD_FACTOR).map(period => {
    const p = fbCampaign(seed, period);
    const clicks = Math.round(p.lp_clicks * 1.4);
    return { period, label: PERIOD_LABEL[period], spend: p.spend, clicks, lp_clicks: p.lp_clicks, sales: p.sales, revenue: p.revenue,
      profit: r2(p.revenue - p.spend), roi: p.spend ? r2((p.revenue - p.spend) / p.spend * 100) : null, cpc: clicks ? r2(p.spend / clicks) : null };
  });
  const ads = c.adsets.flatMap(a => a.ads);
  const landing = seed.spend ? landingFunnel(seed.n / 20, TEMPLATE_FUNNEL.slice(0, 1)) : null;
  return {
    ...publicCampaign(c),
    periods,
    composition: {
      adsets: c.adsets.length, adsets_active: c.adsets.filter(a => a.effective_status === 'ACTIVE').length,
      ads: ads.length, ads_active: ads.filter(a => a.effective_status === 'ACTIVE').length, moderation: c.moderation,
    },
    keitaro_error: null,
    push: {
      id: `psh_demo_${seed.n}`, status: 'done', created_at: c.created_time, author: 'Demo Owner',
      product_id: c._product.id, product_title: c._product.title, source_url: c._product.source_url,
      template: 'Demo Store', geo: seed.geo, kt_campaign_id: String(9100 + seed.n), offer_ids: [9001],
      bid: 1.25, daily_budget: 20,
    },
    landing: landing ? { period: { from: ymd(6 * DAY), to: ymd() }, ...landing } : null,
  };
}

// Keitaro report rows by campaign, scaled to the asked range.
function rangeFactor(q) {
  if (q.from && q.to) return Math.max(1, Math.round((new Date(q.to) - new Date(q.from)) / DAY) + 1) * 0.95;
  return PERIOD_FACTOR[q.range] || { last_7_days: 7.4, last_30_days: 29 }[q.range] || 1;
}
function keitaroRows(q) {
  const f = rangeFactor(q);
  return CAMPAIGN_SEEDS.filter(s => !s.archived).map(s => {
    const c = fbCampaign(s, 'today');
    const product = shortTitle(c._product);
    const cost = r2((s.spend || 9 + s.n) * f);
    const revenue = r2((s.revenue || (s.n % 2 ? 0 : 29.9)) * f);
    const clicks = Math.round((c.lp_clicks || 40 + s.n * 5) * 1.4 * f);
    const conversions = Math.round((s.sales || (s.n % 2 ? 0 : 1)) * f);
    return {
      campaign: `[${s.buyer === 'demo-buyer-1' ? 'DemoBuyer1' : 'DemoBuyer2'}] ${product} ${s.geo}`, campaign_id: 9100 + s.n,
      clicks, lp_clicks: Math.round(clicks * 0.7), conversions, sales: conversions, leads: conversions,
      revenue, cost, profit: r2(revenue - cost), roi: cost ? r2((revenue - cost) / cost * 100) : 0,
    };
  });
}
function keitaroDaily(days = 30) {
  return { rows: Array.from({ length: days }, (_, i) => {
    const k = days - 1 - i;
    const cost = r2(180 + noise(k + 3) * 120);
    return { day: ymd(k * DAY), cost, revenue: r2(cost * (0.8 + noise(k + 11) * 0.9)) };
  }) };
}

function dashboard(range) {
  const period = { today: 'today', yesterday: 'yesterday', last_7_days: 'last_7_days', last_30_days: 'last_30_days' }[range] || 'today';
  const camps = CAMPAIGN_SEEDS.map(s => fbCampaign(s, period));
  const spend = r2(camps.reduce((t, c) => t + c.spend, 0));
  const revenue = r2(camps.reduce((t, c) => t + c.revenue, 0));
  const clicks = camps.reduce((t, c) => t + c.lp_clicks, 0);
  const days = { today: 0, yesterday: 1, last_7_days: 6, last_30_days: 29 }[period];
  const f = PERIOD_FACTOR[period];
  return {
    keitaro: { clicks: Math.round(clicks * 1.4), conversions: camps.reduce((t, c) => t + c.sales, 0), revenue, cost: spend },
    fb: { spend, clicks, impressions: Math.round(clicks * 38), leads: camps.reduce((t, c) => t + c.leads, 0) },
    tiktok: { spend: r2(22.4 * f), clicks: Math.round(310 * f), impressions: Math.round(18400 * f), conversions: Math.round(2 * f) },
    totals: { spend: r2(spend + 22.4 * f), revenue, profit: r2(revenue - spend - 22.4 * f), roi: r2((revenue - spend - 22.4 * f) / (spend + 22.4 * f) * 100) },
    period: { from: ymd((period === 'yesterday' ? 1 : days) * DAY), to: ymd(period === 'yesterday' ? DAY : 0), range },
  };
}

// The query builder only reads, so the demo answers it with generated rows.
function analyticsQuery(plan = {}) {
  const dims = Array.isArray(plan.dimensions) ? plan.dimensions : [];
  const metrics = Array.isArray(plan.metrics) ? plan.metrics : [];
  const from = plan.from ? new Date(plan.from) : new Date(now - 7 * DAY);
  const to = plan.to ? new Date(plan.to) : new Date(now);
  const days = Math.min(Math.max(Math.round((to - from) / DAY) + 1, 1), 60);
  const values = {
    date: Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY).toISOString().slice(0, 10)),
    campaign: keitaroRows({}).map(r => r.campaign),
    buyer: ['DemoBuyer1', 'DemoBuyer2'],
    geo: ['FR', 'BE', 'CH', 'DE'],
    os: ['iOS', 'Android', 'Windows'], device: ['mobile', 'desktop', 'tablet'],
    browser: ['Chrome', 'Safari', 'Facebook App'], language: ['fr', 'nl', 'de'],
    offer: OFFERS.map(o => o.name), landing: TEMPLATE_FUNNEL.map(t => t.name),
    adset: ['25–65 все', '35–65 женщины', '25–55 мужчины'], ad: ['Креатив 1 · clean', 'Креатив 2 · dark'],
    week: ['неделя 1', 'неделя 2', 'неделя 3', 'неделя 4'], month: ['месяц 1', 'месяц 2'],
  };
  let rows = [{}];
  for (const d of dims) rows = rows.flatMap(r => (values[d] || ['—']).map(v => ({ ...r, [d]: v })));
  rows = rows.map((r, i) => {
    const clicks = Math.round(120 + noise(i + 1) * 900);
    const spend = r2(clicks * (0.18 + noise(i + 7) * 0.2));
    const sales = Math.round(clicks * (0.004 + noise(i + 5) * 0.02));
    const revenue = r2(sales * 33.9);
    const all = {
      clicks, spend, revenue, leads: sales, sales, cpc: clicks ? r2(spend / clicks) : 0, cr: clicks ? r2(sales / clicks * 100) : 0,
      cpa: sales ? r2(spend / sales) : 0, roas: spend ? r2(revenue / spend) : 0, roi: spend ? r2((revenue - spend) / spend * 100) : 0,
      profit: r2(revenue - spend), lp_views: Math.round(clicks * 0.8), lp_ctr: r2(30 + noise(i + 9) * 40), epc: clicks ? r2(revenue / clicks) : 0,
    };
    const row = { ...r };
    for (const m of metrics) row[m] = all[m];
    return row;
  });
  const sort = plan.sort?.field;
  if (sort) rows.sort((a, b) => (plan.sort.direction === 'asc' ? 1 : -1) * ((a[sort] > b[sort]) - (a[sort] < b[sort])));
  return { rows: rows.slice(0, Number(plan.limit) || 50) };
}

// ─── Accounts, AdsPower, presets ──────────────────────────────────────────────

const ACCOUNTS = CAB.map((c, i) => ({
  id: `fba_demo_${i + 1}`, workspace_id: WORKSPACE.id, name: `Demo Account ${i + 1}`, email: `account${i + 1}@demo.invalid`,
  status: i === 2 ? 'blocked' : 'active', geo: ['FR', 'BE', 'DE'][i], ap_name: `Demo Profile ${c.profile}`, serial_number: c.profile,
  ip_country: ['fr', 'be', 'de'][i], group_name: i === 1 ? 'buyer2@demo.invalid' : 'buyer1@demo.invalid',
  bm_id: c.bm_id, pixel_ids: [`DEMO-PIXEL-${i + 1}`], bms_count: 1, cabinets_count: 1, pages_count: 1,
  last_checked_at: iso((i + 1) * 3600000), created_at: iso((40 - i * 10) * DAY),
  bms: [{
    id: `fbbm_demo_${i + 1}`, name: c.bm, status: i === 2 ? 'blocked' : 'active',
    cabinets: [{
      id: `fbcab_demo_${i + 1}`, name: c.act_name, external_id: c.act_id, pixel_id: `DEMO-PIXEL-${i + 1}`,
      status: 'active', ready_kind: i === 2 ? 'blocked' : i === 1 ? 'partial' : 'ready',
      ready_label: i === 2 ? 'заблокирован' : i === 1 ? 'нет пикселя CAPI' : 'готов к заливу',
      ready: { kind: i === 2 ? 'blocked' : i === 1 ? 'partial' : 'ready', label: i === 2 ? 'заблокирован' : i === 1 ? 'нет пикселя CAPI' : 'готов к заливу' },
      pixels: [{ id: `DEMO-PIXEL-${i + 1}`, capi: i === 0 }], payment_missing: i === 1,
    }],
    pages: [{ id: `fbpage_demo_${i + 1}`, name: c.page, external_id: c.page_id, status: 'active', ads_running: 4 + i * 3, ads_limit: 250 }],
  }],
}));

const AP_PROFILES = CAB.map((c, i) => ({
  user_id: `demo_ap_${i + 1}`, serial_number: c.profile, name: `Demo Profile ${c.profile}`,
  group_id: `g_demo_${i === 1 ? 2 : 1}`, group_name: i === 1 ? 'buyer2@demo.invalid' : 'buyer1@demo.invalid',
  ip_country: ['fr', 'be', 'de'][i], last_synced_at: iso(5 * 60000),
})).concat([{ user_id: 'demo_ap_4', serial_number: '104', name: 'Demo Profile 104 (скрап)', group_id: 'g_demo_3', group_name: 'scrape', ip_country: 'fr', last_synced_at: iso(5 * 60000) }]);

const URL_PARAMS = 'utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&ad_name={{ad.name}}';
const AD_SETTINGS = [
  { id: 'ads_demo_1', name: 'FR · лиды · 3 адсета', geo: 'FR', budget: 20, bid: 1.25, adsets: 3, products: ['prd_demo_1', 'prd_demo_3'] },
  { id: 'ads_demo_2', name: 'BE · продажи · женщины 35+', geo: 'BE', budget: 15, bid: 1.1, adsets: 2, products: ['prd_demo_2'], genders: 'female', age_min: 35 },
  { id: 'ads_demo_3', name: 'CH · тест · 5 адсетов', geo: 'CH', budget: 10, bid: 0.95, adsets: 5, products: [], creo: 'one-per' },
].map((p, i) => ({
  id: p.id, name: p.name, product_ids: p.products, age_min: p.age_min || 25, age_max: 65, genders: p.genders || 'all', devices: 'all',
  adsets_count: p.adsets, budget: p.budget, bid_strategy: 'LOWEST_COST_WITH_BID_CAP', bid_amount: p.bid,
  objective: i === 1 ? 'OUTCOME_SALES' : 'OUTCOME_LEADS', pixel_event: i === 1 ? 'PURCHASE' : 'LEAD', call_to_action: 'LEARN_MORE',
  auto_placement: true, url_params: URL_PARAMS, creo_mode: p.creo || 'all-all', creo_per_adset: p.creo ? 1 : 3,
  all_creatives: false, platforms: [], bid_amounts: null, created_at: iso((i + 1) * 5 * DAY),
  form: { geo: p.geo, domain_id: 701, product_ids: p.products },
}));
const AD_SETTINGS_STATS = { ads_demo_1: 14, ads_demo_2: 6, ads_demo_3: 2 };

const AD_PRESETS = [
  { id: 'adp_demo_1', name: 'Старый пресет FR', objective: 'OUTCOME_SALES', daily_budget: 30, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', bid_amount: null,
    optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', fb_cabinet_id: '', fb_page_id: '', fb_pixel_id: 'DEMO-PIXEL-1', pixel_event: 'Purchase',
    countries: ['FR'], age_min: 25, age_max: 65, created_at: iso(70 * DAY) },
  { id: 'adp_demo_2', name: 'Старый пресет BE/CH', objective: 'OUTCOME_LEADS', daily_budget: 15, bid_strategy: 'COST_CAP', bid_amount: 2,
    optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', fb_cabinet_id: '', fb_page_id: '', fb_pixel_id: '', pixel_event: 'Lead',
    countries: ['BE', 'CH'], age_min: 30, age_max: 60, created_at: iso(80 * DAY) },
];

const BUNDLE_PRESETS = [
  { id: 'bp_demo_1', name: '1 / 2+1 · EUR', currency: 'EUR', config: bundles(34.9, 9001), created_at: iso(20 * DAY) },
  { id: 'bp_demo_2', name: '1 / 2 / 3 · EUR', currency: 'EUR', config: [
    { qty: '1', old_price: '', price: '29.90', currency: 'EUR', offer_id: 9003 },
    { qty: '2', old_price: '', price: '49.90', currency: 'EUR', offer_id: 9004 },
    { qty: '3', old_price: '', price: '64.90', currency: 'EUR', offer_id: 9004 },
  ], created_at: iso(25 * DAY) },
];
const CREATIVE_PRESETS = [
  { id: 'cp_demo_1', name: 'FR · квадрат · 4 стиля', params: { headline: 'Offre du jour : -50 %', language: 'fr', format: '1x1', count: '4', diversify: true } },
  { id: 'cp_demo_2', name: 'NL · сторис', params: { headline: 'Vandaag gratis verzending', language: 'nl', format: '2x3', count: '2', diversify: false } },
];

const LANDING_TEMPLATES = [
  { id: 'lt_demo_1', name: 'Demo Store', type: 'store', store: 'Demo Store', state: 'ready', geos: ['FR', 'BE', 'CH', 'LU', 'DE', 'NL', 'IT', 'ES'],
    synced_at: iso(3 * DAY), created_at: iso(50 * DAY) },
  { id: 'lt_demo_2', name: 'Demo Quiz', type: 'store', store: 'Demo Quiz', state: 'ready', geos: ['FR', 'BE'], synced_at: iso(6 * DAY), created_at: iso(40 * DAY) },
  { id: 'lt_demo_3', name: 'Demo Form Order', type: 'form', store: null, state: 'ready', geos: ['FR'], synced_at: null, created_at: iso(20 * DAY) },
  { id: 'lt_demo_4', name: 'White Page', type: 'white', store: null, state: 'draft', geos: [], synced_at: null, created_at: iso(10 * DAY) },
].map(t => ({ ...t, versions: t.geos.map((geo, i) => ({
  geo, version: 1 + (i % 3), language: { FR: 'fr', BE: 'fr', CH: 'fr', LU: 'fr', DE: 'de', NL: 'nl', IT: 'it', ES: 'es' }[geo], files_count: 3 + (i % 2), size_bytes: 42000 + i * 1700,
})) }));

// ─── Pushes ───────────────────────────────────────────────────────────────────

const PUSHES = CAMPAIGN_SEEDS.slice(0, 6).map((s, i) => {
  const c = fbCampaign(s);
  const failed = i === 4;
  const running = i === 0;
  const at = now - (i * 1.5 + 0.2) * DAY;
  const t = (m) => new Date(at + m * 60000).toISOString();
  return {
    id: `psh_demo_${s.n}`, product_id: c._product.id, product_name: c._product.title,
    status: running ? 'running' : failed ? 'failed' : 'done',
    params: { campaign_name: `${shortTitle(c._product)} — ${s.geo}`, countries: [s.geo], geo: s.geo, daily_budget: 20, run_now: false, offer_ids: [9001] },
    kt_campaign_id: failed ? null : String(9100 + s.n), fb_campaign_id: failed || running ? null : c.id,
    error: failed ? `${CAB[s.cab].act_name}: Facebook отклонил способ оплаты (демо-ошибка)` : null,
    dismissed: false, created_at: new Date(at).toISOString(),
    log: [
      { ts: t(0), step: 'keitaro_campaign', campaign_id: 9100 + s.n },
      { ts: t(1), step: 'agent_job', profile: CAB[s.cab].profile },
      ...(running ? [{ ts: t(2), step: 'fb_adsets', created: 2 }]
        : failed ? [{ ts: t(3), step: 'fb_error', message: 'payment method' }]
        : [{ ts: t(2), step: 'fb_campaign', id: c.id }, { ts: t(4), step: 'done' }]),
    ],
  };
});
PUSHES.push({
  id: 'psh_demo_old', product_id: 'prd_demo_5', product_name: PRODUCTS[4].title, status: 'failed',
  params: { campaign_name: 'Brosse barbecue — FR', countries: ['FR'], geo: 'FR', daily_budget: 10 },
  kt_campaign_id: null, fb_campaign_id: null, error: 'Профиль AdsPower не открылся (демо-ошибка)', dismissed: true,
  created_at: iso(12 * DAY), log: [{ ts: iso(12 * DAY), step: 'agent_error', message: 'profile closed' }],
});
const PUSH_TRACE = { steps: [
  { name: 'Кампания и поток в Keitaro', status: 'done' },
  { name: 'Открыть профиль AdsPower', status: 'done' },
  { name: 'Создать кампанию в Facebook', status: 'done' },
  { name: 'Создать адсеты', status: 'error', error: 'Facebook отклонил способ оплаты (демо-ошибка)' },
] };

function pushOptions() {
  return {
    products: PRODUCTS.filter(p => p.scrape_status === 'done').map((p, i) => ({
      id: p.id, name: p.title, cover: `${BASE}${p.images[0]}`, photo_reviews_count: i % 3 === 0 ? 2 : 0,
    })),
    landings: [
      ...LANDING_TEMPLATES.filter(t => t.type === 'store').map(t => ({ id: t.id, name: t.name, source: 'local', store: t.store, versions: t.versions })),
      ...KT_LANDINGS.map(l => ({ id: l.id, name: l.name, source: 'keitaro' })),
    ],
    domains: KT_DOMAINS,
    cabinets: ACCOUNTS.map((a, i) => {
      const cab = a.bms[0].cabinets[0];
      const spent = r2(40 + i * 23.5);
      return {
        id: cab.id, external_id: cab.external_id, name: cab.name, profile: a.serial_number, pixel_id: cab.pixel_id,
        pages: a.bms[0].pages.map(p => ({ id: p.id, external_id: p.external_id, name: p.name })),
        ready_kind: cab.ready_kind, ready_label: cab.ready_label, payment_missing: cab.payment_missing,
        active_ads: 6 - i * 2, spent_today: spent, currency: 'USD', daily_limit: 250, limit_left: r2(250 - spent), data_at: iso(14 * 60000),
      };
    }),
    creatives: CREATIVES.filter(c => c.status === 'done' && c.type === 'image').map(c => ({
      id: c.id, product_id: c.product_id, language: c.metadata.language, url: c.file_url,
    })),
    presets: AD_SETTINGS,
  };
}

// ─── Analytics extras ─────────────────────────────────────────────────────────

const BEHAVIOR = {
  base: { visitors: 3220, pick_rate: 31.4, buy_rate: 12.6, conv_rate: 3.9 },
  quiz: { started: 960, started_pct: 64, completed_pct: 41, last_step: 5 },
  by: {
    depth: [25, 50, 75, 100].map((mark, i) => ({ mark, pct: [88, 67, 46, 23][i] })),
    time: [['< 10 с', 22, 3], ['10–30 с', 31, 9], ['30–60 с', 26, 18], ['> 60 с', 21, 34]].map(([value, share, buy_rate]) => ({ value, share, buy_rate })),
    device: [['mobile', 78, 12.1], ['desktop', 17, 15.4], ['tablet', 5, 9.8]].map(([value, share, buy_rate]) => ({ value, share, buy_rate })),
    exit: [['Отзывы', 28], ['Комплекты', 24], ['Шапка', 19], ['Описание', 15], ['Футер', 14]].map(([value, share]) => ({ value, share })),
    placement: [['Facebook_Mobile_Feed', 44, 12.8], ['Instagram_Stories', 21, 10.2], ['Instagram_Feed', 18, 13.9], ['Facebook_Reels', 11, 9.1], ['Facebook_Right_Column', 6, 5.4]]
      .map(([value, share, buy_rate]) => ({ value, share, buy_rate })),
  },
  blocks: [['Кнопка «Купить»', 1260, 14, 0], ['Комплект 2+1', 980, 3, 0], ['Галерея', 760, 0, 41], ['Отзывы', 410, 0, 12], ['Таймер', 120, 9, 33]]
    .map(([name, clicks, rage_clicks, dead_clicks], i) => ({ id: `block_${i + 1}`, name, clicks, rage_clicks, dead_clicks })),
};

function buyers(q) {
  const rows = [['DemoBuyer1', 1], ['DemoBuyer2', 0.7], ['Demo Lead', 0.35]].map(([buyer, k], i) => {
    const clicks = Math.round(2400 * k);
    const sales = Math.round(clicks * 0.012);
    const cost = r2(clicks * 0.27);
    const profit = r2(sales * 33.9 - cost);
    const row = { buyer, clicks, sales, cost, profit, roi: r2(profit / cost * 100), cr: r2(sales / clicks * 100) };
    if (q.compare === 'true') row.compare = { profit_diff: r2((noise(i + 2) - 0.4) * 120) };
    return row;
  });
  return { rows };
}

const TIKTOK_ACCOUNTS = [
  { id: 'tt_demo_1', name: 'Demo TikTok FR', advertiser_id: 'DEMO-ADV-0001', status: 'active', currency: 'EUR', timezone: 'Europe/Paris', pixel_id: 'DEMO-TT-PIXEL-1' },
  { id: 'tt_demo_2', name: 'Demo TikTok BE', advertiser_id: 'DEMO-ADV-0002', status: 'paused', currency: 'EUR', timezone: 'Europe/Brussels', pixel_id: null },
];

// ─── Router ───────────────────────────────────────────────────────────────────

const notFound = Symbol('not found');
const byId = (list, id) => list.find(x => String(x.id) === String(id)) || notFound;

const GET = [
  [/^\/api\/auth\/me$/, () => ({ user: USER, workspace: WORKSPACE })],
  [/^\/api\/folders$/, () => FOLDERS.map(f => ({ ...f, product_count: PRODUCTS.filter(p => p.folder_id === f.id).length, created_at: iso(30 * DAY) }))],
  [/^\/api\/folders\/counts$/, () => ({ total: PRODUCTS.length, unfiled: PRODUCTS.filter(p => !p.folder_id).length })],
  [/^\/api\/products$/, (q) => productList(q)],
  [/^\/api\/products\/([^/]+)\/reviews$/, (q, [id]) => (byId(PRODUCTS, id) === notFound ? notFound
    : (byId(PRODUCTS, id).reviews_count ? REVIEWS.map((r, i) => ({ id: `rv_${id}_${i}`, product_id: id, images: [], ...r })) : []))],
  [/^\/api\/products\/([^/]+)$/, (q, [id]) => byId(PRODUCTS, id)],
  [/^\/api\/scrape\/engine$/, () => ({ engine: 'own', supported_sources: ['amazon'] })],
  [/^\/api\/scrape\/similar\/[^/]+$/, () => []],
  [/^\/api\/scrape\/status\/([^/]+)$/, (q, [id]) => byId(PRODUCTS, id)],
  [/^\/api\/creatives$/, (q) => CREATIVES.filter(c => (!q.product_id || c.product_id === q.product_id) && (!q.status || c.status === q.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))],
  [/^\/api\/creatives\/source$/, () => ({ fa_available: false, active: 'local', engine: 'own', renderer: 'html-templates', generative_ai: false, supported_scrapers: ['amazon'] })],
  [/^\/api\/creatives\/spend$/, () => ({ total_usd: 0, count: 0, count_measured: 0, count_unmeasured: 0, count_cached: 0, by_day: [], by_author: [], source: 'local' })],
  [/^\/api\/presets\/bundles$/, () => BUNDLE_PRESETS],
  [/^\/api\/presets\/creatives$/, () => CREATIVE_PRESETS],
  [/^\/api\/analytics\/overview$/, () => ({ products_count: PRODUCTS.length, creatives_count: CREATIVES.length, campaigns_count: PUSHES.length })],
  [/^\/api\/analytics\/daily$/, (q) => keitaroDaily(Number(q.days) || 30).rows.map(r => ({ date: r.day, spend: r.cost, revenue: r.revenue }))],
  [/^\/api\/analytics\/landing-funnel$/, (q) => ({ from: q.from, to: q.to, group: q.group || 'template', ...landingFunnel(rangeFactor(q) / 7) })],
  [/^\/api\/analytics\/landing-behavior$/, () => BEHAVIOR],
  [/^\/api\/analytics\/buyers$/, (q) => buyers(q)],
  [/^\/api\/analytics\/dashboard$/, (q) => dashboard(q.range)],
  [/^\/api\/campaigns$/, () => []],
  [/^\/api\/campaigns\/fb$/, (q) => {
    const period = PERIOD_FACTOR[q.period] ? q.period : 'today';
    return { period, campaigns: CAMPAIGN_SEEDS.map(s => publicCampaign(fbCampaign(s, period))), keitaro_error: null };
  }],
  [/^\/api\/campaigns\/fb\/([^/]+)\/summary$/, (q, [id]) => fbSummary(id)],
  [/^\/api\/campaigns\/fb\/([^/]+)\/history$/, (q, [id]) => ({ events: [
    { at: iso(3 * 3600000), text: 'Бюджет адсета «25–65 все»: 15 → 20', result: 'done', error: null, user_name: 'Demo Buyer 1' },
    { at: iso(DAY), text: 'Объявление «Креатив 2 · dark» выключено', result: 'done', error: null, user_name: 'Demo Lead' },
    { at: iso(2 * DAY), text: 'Дубль адсета «35–65 женщины»', result: 'failed', error: 'Лимит адсетов кабинета (демо)', user_name: 'Demo Buyer 1' },
    { at: fbSummary(id).created_time, text: 'Залита платформой', result: 'done', error: null, user_name: 'Demo Owner' },
  ] })],
  [/^\/api\/campaigns\/([^/]+)\/history$/, () => ({ events: [{ at: iso(DAY), event: 'Залита платформой', user: 'Demo Owner' }] })],
  [/^\/api\/campaigns\/([^/]+)\/ads$/, () => ({ adsets: [] })],
  [/^\/api\/search\/history$/, () => [
    { queries: ['lampe solaire jardin', 'guirlande solaire'], marketplace: 'fr', results_count: 48 },
    { queries: ['organiseur tiroir bambou'], marketplace: 'fr', results_count: 31 },
    { queries: ['yoga mat antislip'], marketplace: 'de', results_count: 27 },
  ]],
  [/^\/api\/team\/members$/, () => PEOPLE.map(({ keitaro_tag, ...p }) => p)],
  [/^\/api\/accounts$/, () => ACCOUNTS],
  [/^\/api\/agent\/status$/, () => ({ configured: true, seen_at: iso(40000), online: true })],
  [/^\/api\/adspower\/profiles$/, (q) => { const list = AP_PROFILES.filter(p => !q.group_id || p.group_id === q.group_id); return { list, page_size: list.length }; }],
  [/^\/api\/adspower\/groups$/, () => ({ list: [...new Map(AP_PROFILES.map(p => [p.group_id, p.group_name]))].map(([group_id, group_name]) => ({ group_id, group_name })) })],
  [/^\/api\/keitaro\/stats$/, (q) => ({ rows: keitaroRows(q) })],
  [/^\/api\/keitaro\/stats\/daily$/, (q) => keitaroDaily(Math.min(Number(q.days) || 30, 90))],
  [/^\/api\/keitaro\/campaigns$/, () => []],
  [/^\/api\/keitaro\/campaigns\/deleted$/, () => []],
  [/^\/api\/keitaro\/campaigns\/([^/]+)\/streams$/, () => [
    { id: 1, name: 'Демо-поток: оффер', type: 'regular', schema: 'landings', offers: [{ offer_id: 9001 }], weight: 100, state: 'active' },
    { id: 2, name: 'Демо-поток: вайт', type: 'forced', schema: 'landings', offers: [], weight: null, state: 'active' },
  ]],
  [/^\/api\/keitaro\/groups$/, () => KT_GROUPS],
  [/^\/api\/keitaro\/offers$/, () => OFFERS],
  [/^\/api\/keitaro\/landings$/, () => KT_LANDINGS],
  [/^\/api\/keitaro\/domains$/, () => KT_DOMAINS],
  [/^\/api\/keitaro\/settings$/, () => KT_SETTINGS],
  [/^\/api\/ad-presets$/, () => AD_PRESETS],
  [/^\/api\/ad-settings$/, () => AD_SETTINGS],
  [/^\/api\/ad-settings\/stats$/, () => AD_SETTINGS_STATS],
  [/^\/api\/push$/, (q) => PUSHES.filter(p => (q.dismissed === 'true' ? p.dismissed : !p.dismissed) && (!q.status || p.status === q.status))],
  [/^\/api\/push\/options$/, () => pushOptions()],
  [/^\/api\/push\/([^/]+)\/trace$/, () => PUSH_TRACE],
  [/^\/api\/push\/([^/]+)$/, (q, [id]) => byId(PUSHES, id)],
  [/^\/api\/landings\/templates$/, () => LANDING_TEMPLATES],
  [/^\/api\/admin\/users$/, () => PEOPLE],
  [/^\/api\/tiktok\/accounts$/, () => TIKTOK_ACCOUNTS],
  [/^\/api\/mcp-tokens$/, () => []],
  [/^\/api\/tiktok\/pixels\/[^/]+$/, () => []],
];

// Requests that only read although they are POSTs.
const READ_POST = [
  [/^\/api\/analytics\/query$/, (q, m, body) => analyticsQuery(body)],
];

// Leaving the site (TikTok OAuth) or polling an agent job that can never exist in the demo.
const BLOCKED_GET = [/^\/api\/tiktok\/oauth\/url$/, /^\/api\/agent\/jobs\//];

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// → { status, data }
async function answer(method, path, query, body) {
  const m = String(method || 'get').toUpperCase();
  const blocked = m === 'GET' && BLOCKED_GET.some(re => re.test(path));
  const routes = blocked ? [] : m === 'GET' ? GET : m === 'POST' ? READ_POST : [];
  for (const [re, handler] of routes) {
    const match = path.match(re);
    if (!match) continue;
    await wait(120);
    const data = handler(query || {}, match.slice(1), body);
    if (data === notFound) return { status: 404, data: { error: 'В демо-версии такой записи нет' } };
    return { status: 200, data: clone(data) };
  }
  if (m === 'GET' && !blocked) {
    console.warn('[demo] no fixture for GET', path);
    return { status: 404, data: { error: 'В демо-версии этого раздела нет данных' } };
  }
  // Anything that would create, change or delete — or leave the demo — is refused.
  await wait(250);
  return { status: 403, data: { error: DENIED } };
}

const apiPath = (url) => {
  const p = String(url || '').split('?')[0];
  const i = p.indexOf('/api/');
  return i >= 0 ? p.slice(i) : p;
};
const parseBody = (data) => {
  if (!data || typeof data !== 'string') return data && typeof data === 'object' && !(data instanceof FormData) ? data : undefined;
  try { return JSON.parse(data); } catch { return undefined; }
};

// axios adapter: same contract as the network one (resolve 2xx, reject AxiosError otherwise).
export async function demoAdapter(config) {
  const url = new URL(config.url || '', window.location.origin);
  const query = { ...Object.fromEntries(url.searchParams), ...(config.params || {}) };
  for (const k of Object.keys(query)) if (query[k] === undefined) delete query[k];
  const { status, data } = await answer(config.method, apiPath(config.url), query, parseBody(config.data));
  const response = { data, status, statusText: status === 200 ? 'OK' : status === 403 ? 'Forbidden' : 'Not Found', headers: {}, config, request: {} };
  if (status >= 200 && status < 300) return response;
  throw new AxiosError(data.error, status === 403 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE', config, {}, response);
}

// window.fetch for the few raw calls (reviews, uploads, translation); anything outside /api/ is untouched.
export async function demoFetch(input, init = {}, realFetch) {
  const raw = typeof input === 'string' ? input : input?.url || String(input);
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.includes('/api/')) return realFetch(input, init);
  const method = init.method || (typeof input === 'object' && input?.method) || 'GET';
  const { status, data } = await answer(method, apiPath(url.pathname), Object.fromEntries(url.searchParams), parseBody(init.body));
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
