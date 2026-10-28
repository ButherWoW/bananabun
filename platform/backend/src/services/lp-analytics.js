import { db } from '../db/client.js';
import { keitaroClient } from './keitaro.js';

// Landing funnel and behaviour from our own tracker (lp_events). Days are UTC; a visitor is one tab.

// FB campaigns the caller may see: buyers — their AdsPower group, lead/owner — the workspace.
async function campaignScope(user) {
  const group = user.role === 'buyer' ? String(user.email || '').toLowerCase() : null;
  const { rows } = await db.query(`
    SELECT c.id FROM fb_campaigns c JOIN fb_accounts fa ON fa.id = c.fb_account_id
      LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE c.workspace_id = $1 AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)
    UNION
    SELECT fb_campaign_id FROM pushes
     WHERE workspace_id = $1 AND fb_campaign_id IS NOT NULL AND ($3::text IS NULL OR created_by = $3)`,
    [user.ws, group, user.role === 'buyer' ? user.id : null]);
  return rows.map(r => String(r.id));
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

// One row per visitor: where they came from and how far they got.
const VISITORS = `
  WITH ev AS (
    SELECT * FROM lp_events
     WHERE at >= $1::date AND at < ($2::date + 1) AND campaign_id = ANY($3)
       AND ($4::text[] IS NULL OR campaign_id = ANY($4))
  ), v AS (
    SELECT visitor, MIN(campaign_id) campaign_id, MIN(template_id) template_id, MIN(product_id) product_id, MIN(geo) geo,
           MIN(device) device, MIN(os) os, MIN(app) app, MIN(placement) placement, MIN(source) source,
           MIN(adset_id) adset_id, MIN(ad_id) ad_id, MIN(country) country,
           BOOL_OR(event = 'bundle_select') picked, BOOL_OR(event = 'buy_click') bought,
           COALESCE(MAX(num) FILTER (WHERE event = 'depth'), 0) depth,
           MAX(num) FILTER (WHERE event = 'leave') secs,
           (ARRAY_AGG(NULLIF(block, '') ORDER BY at DESC) FILTER (WHERE event = 'leave'))[1] exit_block,
           BOOL_OR(event = 'leave') left_page,
           GREATEST(COALESCE(MAX(num) FILTER (WHERE event = 'quiz_answer'), 0), COUNT(*) FILTER (WHERE event = 'quiz_answer')) quiz_steps
      FROM ev GROUP BY visitor
  )`;

// Sales by FB campaign from Keitaro (sub_id_2), for the funnel's last step.
async function keitaroSales(ws, from, to) {
  const w = await db.findOne('workspaces', { id: ws });
  if (!w?.keitaro_url || !w?.keitaro_api_key) return null;
  try {
    const data = await keitaroClient(w.keitaro_url, w.keitaro_api_key).stats({ from, to }, ['sub_id_2'], ['sales']);
    const m = new Map();
    for (const r of data?.rows || []) if (/^\d+$/.test(String(r.sub_id_2))) m.set(String(r.sub_id_2), Number(r.sales) || 0);
    return m;
  } catch { return null; }
}

const GROUP_COL = { campaign: 'campaign_id', template: 'template_id', product: 'product_id', geo: 'geo' };

export async function landingFunnel(user, { from, to, group = 'template', campaigns = null }) {
  const scope = await campaignScope(user);
  const col = GROUP_COL[group] || 'template_id';
  const { rows } = await db.query(`${VISITORS}
    SELECT ${col} AS key, ARRAY_AGG(DISTINCT campaign_id) AS campaigns, COUNT(*)::int views,
           COUNT(*) FILTER (WHERE picked)::int bundle_pick, COUNT(*) FILTER (WHERE bought)::int buy_click,
           COUNT(*) FILTER (WHERE depth >= 75)::int scroll_75
      FROM v GROUP BY 1 ORDER BY views DESC`, [from, to, scope, campaigns]);

  const names = new Map();
  const keys = rows.map(r => r.key).filter(Boolean);
  if (group === 'template' && keys.length) {
    (await db.query(`SELECT id, name FROM landing_templates WHERE id = ANY($1)`, [keys])).rows.forEach(r => names.set(r.id, r.name));
  } else if (group === 'product' && keys.length) {
    (await db.query(`SELECT id, title FROM products WHERE id = ANY($1)`, [keys])).rows.forEach(r => names.set(r.id, r.title));
  } else if (group === 'campaign' && keys.length) {
    (await db.query(`SELECT id, name FROM fb_campaigns WHERE id = ANY($1)`, [keys])).rows.forEach(r => names.set(r.id, r.name));
  }

  const sales = await keitaroSales(user.ws, from, to);
  const out = rows.map(r => {
    const s = sales ? r.campaigns.reduce((t, id) => t + (sales.get(String(id)) || 0), 0) : null;
    return {
      key: r.key, name: names.get(r.key) || r.key || 'без метки',
      views: r.views, bundle_pick: r.bundle_pick, buy_click: r.buy_click, scroll_75: r.scroll_75, sales: s,
      pick_rate: pct(r.bundle_pick, r.views), buy_rate: pct(r.buy_click, r.views), scroll_pct: pct(r.scroll_75, r.views),
      sale_per_buy: s != null ? pct(s, r.buy_click) : null,
    };
  });
  const sum = (k) => out.reduce((t, r) => t + (r[k] || 0), 0);
  const totals = { views: sum('views'), bundle_pick: sum('bundle_pick'), buy_click: sum('buy_click'), scroll_75: sum('scroll_75'), sales: sales ? sum('sales') : null };
  totals.buy_rate = pct(totals.buy_click, totals.views);
  totals.pick_rate = pct(totals.bundle_pick, totals.views);
  return { group, period: { from, to, days: 'сутки UTC' }, rows: out, totals, sales_source: sales ? 'keitaro' : null };
}

const TIME_BUCKETS = `CASE WHEN secs < 10 THEN '0-10s' WHEN secs < 30 THEN '10-30s' WHEN secs < 60 THEN '30-60s' WHEN secs < 180 THEN '1-3m' ELSE '3m+' END`;
const TIME_ORDER = ['0-10s', '10-30s', '30-60s', '1-3m', '3m+'];

export async function landingBehavior(user, { from, to, campaigns = null, top = 8 }) {
  const scope = await campaignScope(user);
  const args = [from, to, scope, campaigns];
  const q = async (sql) => (await db.query(`${VISITORS} ${sql}`, args)).rows;

  const [base] = await q(`SELECT COUNT(*)::int visitors, COUNT(*) FILTER (WHERE picked)::int picked,
      COUNT(*) FILTER (WHERE bought)::int bought, COUNT(*) FILTER (WHERE depth >= 75)::int read_75 FROM v`);
  const visitors = base?.visitors || 0;
  const result = {
    period: { from, to, days: 'сутки UTC' },
    enabled: true,
    base: { ...base, pick_rate: pct(base.picked, visitors), buy_rate: pct(base.bought, visitors), read_rate: pct(base.read_75, visitors), conv_rate: null },
    by: {},
    missing: { converted: 'конверсии посетителей пока не связаны с продажами Keitaro' },
  };
  if (!visitors) return { ...result, note: 'За этот период посетителей нет: счётчик стоит на лендингах, собранных после 28.10' };

  const slice = (col, label = col) => q(`
    SELECT COALESCE(NULLIF(${col}::text, ''), 'нет данных') AS value, COUNT(*)::int visitors,
           COUNT(*) FILTER (WHERE picked)::int p, COUNT(*) FILTER (WHERE bought)::int b, COUNT(*) FILTER (WHERE depth >= 75)::int r
      FROM v GROUP BY 1 ORDER BY 2 DESC LIMIT ${Number(top) || 8}`)
    .then(rows => rows.map(x => ({ value: x.value, visitors: x.visitors, share: pct(x.visitors, visitors),
      pick_rate: pct(x.p, x.visitors), buy_rate: pct(x.b, x.visitors), read_rate: pct(x.r, x.visitors) })));

  for (const [k, col] of Object.entries({ device: 'device', os: 'os', app: 'app', placement: 'placement', source: 'source', adset: 'adset_id', ad: 'ad_id', country: 'country' })) {
    result.by[k] = await slice(col);
  }
  if (result.by.country.every(x => x.value === 'нет данных')) { delete result.by.country; result.missing.country = 'страна посетителя не определяется'; }

  const time = await q(`SELECT ${TIME_BUCKETS} AS value, COUNT(*)::int visitors, COUNT(*) FILTER (WHERE picked)::int p,
      COUNT(*) FILTER (WHERE bought)::int b, COUNT(*) FILTER (WHERE depth >= 75)::int r FROM v WHERE secs IS NOT NULL GROUP BY 1`);
  result.by.time = TIME_ORDER.map(t => time.find(x => x.value === t)).filter(Boolean).map(x => ({ value: x.value, visitors: x.visitors,
    share: pct(x.visitors, visitors), pick_rate: pct(x.p, x.visitors), buy_rate: pct(x.b, x.visitors), read_rate: pct(x.r, x.visitors) }));

  result.by.depth = await Promise.all([25, 50, 75, 100].map(async (m) => {
    const [r] = await q(`SELECT COUNT(*) FILTER (WHERE depth >= ${m})::int n FROM v`);
    return { mark: m, visitors: r.n, pct: pct(r.n, visitors) };
  }));

  result.by.exit = (await q(`SELECT COALESCE(exit_block, 'до первого блока') AS value, COUNT(*)::int visitors,
      COUNT(*) FILTER (WHERE picked)::int p, COUNT(*) FILTER (WHERE depth >= 75)::int r
      FROM v WHERE NOT bought AND left_page GROUP BY 1 ORDER BY 2 DESC LIMIT ${Number(top) || 8}`))
    .map(x => ({ value: x.value, visitors: x.visitors, share: pct(x.visitors, visitors), pick_rate: pct(x.p, x.visitors), buy_rate: 0, read_rate: pct(x.r, x.visitors) }));

  // Event-level slices: seen blocks, clicks by block, marked buttons.
  const evRows = async (where, keyExpr) => (await db.query(`
    SELECT ${keyExpr} AS value, COUNT(*)::int events, COUNT(DISTINCT visitor)::int visitors FROM lp_events
     WHERE at >= $1::date AND at < ($2::date + 1) AND campaign_id = ANY($3) AND ($4::text[] IS NULL OR campaign_id = ANY($4)) AND ${where}
     GROUP BY 1 ORDER BY 3 DESC LIMIT ${Number(top) || 8}`, args)).rows
    .map(x => ({ ...x, visitor_pct: pct(x.visitors, visitors) }));
  result.by.seen = await evRows(`event = 'seen'`, `block`);
  result.by.click = await evRows(`event = 'click'`, `COALESCE(NULLIF(block, ''), 'вне размеченных блоков')`);
  result.by.event = await evRows(`event IN ('buy_click', 'bundle_select', 'quiz_answer')`, `event`);

  const [quiz] = await q(`SELECT COUNT(*) FILTER (WHERE quiz_steps > 0)::int started, MAX(quiz_steps)::int last_step,
      COUNT(*) FILTER (WHERE quiz_steps > 0 AND quiz_steps >= (SELECT MAX(quiz_steps) FROM v))::int completed FROM v`);
  if (quiz?.started) {
    result.quiz = { started: quiz.started, started_pct: pct(quiz.started, visitors), last_step: quiz.last_step,
      completed_pct: pct(quiz.completed, quiz.started) };
  }
  return result;
}
