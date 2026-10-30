import { db } from '../../db/client.js';
import { landingFunnel, landingBehavior } from '../../services/lp-analytics.js';
import { keitaroClient } from '../../services/keitaro.js';
import { tiktokClient } from '../../services/tiktok.js';
import { buyerScope, inScope } from './keitaro.js';
import { ownUser } from '../../middleware/access.js';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Query-builder dimensions → Keitaro grouping. Sub ids follow the push (services/push.js KT_PARAMETERS):
// sub_id_2 FB campaign, sub_id_3 adset id, sub_id_4 ad id, sub_id_5 adset name.
const DIM_MAP = {
  date: 'day', day: 'day', week: 'week', month: 'month',
  campaign: 'campaign', geo: 'country', country: 'country',
  device: 'device_type', os: 'os', browser: 'browser', language: 'language',
  offer: 'offer', landing: 'landing', adset: 'sub_id_3', ad: 'sub_id_4',
};
// Raw Keitaro metrics; every ratio is recomputed from them so rows can be summed (buyer dimension).
const RAW = ['clicks', 'lp_clicks', 'sales', 'leads', 'revenue', 'cost'];
const TIME_DIMS = new Set(['date', 'day', 'week', 'month']);
const METRICS = new Set(['clicks', 'spend', 'cost', 'revenue', 'leads', 'sales', 'profit', 'roi', 'cr', 'lp_views', 'lp_ctr', 'cpc', 'cpa', 'roas', 'epc']);

function finish(r) {
  const cl = r.clicks, cost = r.cost, rev = r.revenue, sales = r.sales;
  return {
    ...r, spend: cost, lp_views: r.lp_clicks, profit: rev - cost,
    roi: cost > 0 ? (rev - cost) / cost * 100 : null,
    cr: cl > 0 ? sales / cl * 100 : null,
    lp_ctr: cl > 0 ? r.lp_clicks / cl * 100 : null,
    cpc: cl > 0 ? cost / cl : null,
    cpa: sales > 0 ? cost / sales : null,
    roas: cost > 0 ? rev / cost : null,
    epc: cl > 0 ? rev / cl : null,
  };
}

// FB campaign id (sub_id_2) → buyer: our pushes first, then the tag in the Keitaro campaign name.
async function buyerResolver(ws, rows) {
  const ids = [...new Set(rows.map(r => String(r.sub_id_2 || '')).filter(id => /^\d+$/.test(id)))];
  const { rows: pushRows } = ids.length ? await db.query(
    `SELECT p.fb_campaign_id, u.name, u.email FROM pushes p JOIN users u ON u.id = p.created_by
      WHERE p.workspace_id = $1 AND p.fb_campaign_id = ANY($2)`, [ws, ids]) : { rows: [] };
  const byId = new Map(pushRows.map(r => [String(r.fb_campaign_id), r.name || r.email?.split('@')[0] || '?']));
  return (r) => byId.get(String(r.sub_id_2 || '')) || buyerTag(r.campaign) || 'без метки';
}

async function keitaroFor(req, reply) {
  const ws = await db.findOne('workspaces', { id: req.user.ws });
  if (!ws?.keitaro_url || !ws?.keitaro_api_key) { reply.status(503).send({ error: 'Keitaro не настроен' }); return null; }
  return keitaroClient(ws.keitaro_url, ws.keitaro_api_key);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86400000;
const utcDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const isDay = (s) => DAY_RE.test(s || '') && new Date(utcDay(s)).toISOString().slice(0, 10) === s;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Previous period of the same length, ending the day before `from`. Pure UTC date arithmetic.
export function prevPeriod(from, to) {
  const f = utcDay(from), t = utcDay(to);
  const days = Math.round((t - f) / MS_DAY) + 1;
  return { from: iso(f - days * MS_DAY), to: iso(f - MS_DAY) };
}

// The comparison range a /query body asks for: compare:'previous' or explicit compare_from/compare_to.
// Returns null (no comparison), a range, or { error }.
export function compareRange(body, from, to) {
  if (body.compare_from || body.compare_to) {
    const cf = body.compare_from, ct = body.compare_to;
    if (!isDay(cf) || !isDay(ct)) return { error: 'compare_from и compare_to — даты YYYY-MM-DD' };
    if (cf > ct) return { error: 'compare_from позже compare_to' };
    return { from: cf, to: ct };
  }
  if (body.compare === 'previous' || body.compare === true) return prevPeriod(from, to);
  if (body.compare) return { error: 'compare: только "previous" или compare_from/compare_to' };
  return null;
}

// Change of one metric between periods. Percent is null when the base is zero or a value is missing.
export function changeOf(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || !Number.isFinite(cur) || !Number.isFinite(prev)) return { abs: null, pct: null };
  return { abs: cur - prev, pct: prev === 0 ? null : (cur - prev) / Math.abs(prev) * 100 };
}

// Buyer name from campaign name tag [Buyer] or [hash][date][Buyer][…]
function buyerTag(name = '') {
  const segs = [...(String(name).match(/^(\[[^\]]*\])+/)?.[0] || '').matchAll(/\[([^\]]*)\]/g)].map(m => m[1]);
  const raw = segs.length >= 6 ? segs[2] : segs[0];
  return (raw || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() || null;
}

export async function analyticsRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/overview', auth, async (req) => {
    const { ws } = req.user;

    const [{ rows: [{ count: products_count }] }, { rows: [{ count: creatives_count }] }, { rows: [{ count: pushes_count }] }] =
      await Promise.all([
        db.query('SELECT COUNT(*) FROM products WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2)', [ws, ownUser(req)]),
        db.query('SELECT COUNT(*) FROM creatives WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2)', [ws, ownUser(req)]),
        db.query('SELECT COUNT(*) FROM pushes WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2)', [ws, ownUser(req)]),
      ]);

    return {
      products_count: Number(products_count),
      creatives_count: Number(creatives_count),
      campaigns_count: Number(pushes_count),
    };
  });

  app.get('/daily', auth, async (req) => {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const { ws } = req.user;

    // Try to get real data from campaigns
    const { rows } = await db.query(
      `SELECT DATE(created_at) as date, SUM(spend) as spend, SUM(revenue) as revenue, SUM(clicks) as clicks
       FROM campaigns WHERE workspace_id = $1 AND ($2::text IS NULL OR created_by=$2) AND created_at >= NOW() - ($3 * INTERVAL '1 day')
       GROUP BY DATE(created_at) ORDER BY date`,
      [ws, ownUser(req), days]
    );

    if (rows.length > 0) {
      return rows.map(r => ({
        date: r.date,
        spend: Number(r.spend),
        revenue: Number(r.revenue),
        roi: r.spend > 0 ? Number(r.revenue) / Number(r.spend) : 0,
        clicks: Number(r.clicks),
      }));
    }

    // No data is shown as no data — never as made-up numbers.
    return [];
  });

  // Landing funnel and behaviour from our own tracker on the landings (no third-party analytics).
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const campaignList = (v) => (v ? String(v).split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)) : null);

  app.get('/landing-funnel', auth, async (req, reply) => {
    const { from, to, group = 'template', campaign } = req.query;
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    return landingFunnel(req.user, { from, to, group, campaigns: campaignList(campaign) });
  });

  app.get('/landing-behavior', auth, async (req, reply) => {
    const { from, to, campaign, template, top } = req.query;
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    const templates = template ? String(template).split(',').map(x => x.trim()).filter(x => /^[A-Za-z0-9_-]{1,40}$/.test(x)) : null;
    return landingBehavior(req.user, { from, to, campaigns: campaignList(campaign), templates: templates?.length ? templates : null, top: Math.min(Number(top) || 8, 30) });
  });

  // Keitaro rows with the extra keys needed for buyer attribution and the buyer's own scope.
  async function scopedRows(req, client, range, grouping, needBuyer) {
    const scope = await buyerScope(req);
    const extra = [...(needBuyer ? ['sub_id_2', 'campaign'] : []), ...(scope ? ['campaign', 'campaign_group'] : [])];
    const data = await client.stats(range, [...new Set([...grouping, ...extra])], RAW);
    let rows = data?.rows || [];
    if (scope) rows = rows.filter(r => inScope(scope, r.campaign, r.campaign_group));
    return rows;
  }

  // Sums raw metrics per key; ratios are recomputed afterwards by finish().
  function aggregate(rows, keyOf, label) {
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const acc = map.get(k) || { ...label(r), ...Object.fromEntries(RAW.map(m => [m, 0])) };
      for (const m of RAW) acc[m] += Number(r[m]) || 0;
      map.set(k, acc);
    }
    return [...map.values()].map(finish);
  }

  // Buyer stats from Keitaro + our pushes (buyer: only their own campaigns), optional previous period.
  app.get('/buyers', auth, async (req, reply) => {
    const { from, to, compare } = req.query;
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    const client = await keitaroFor(req, reply);
    if (!client) return;
    const pp = prevPeriod(from, to);
    let main, prev;
    try {
      [main, prev] = await Promise.all([
        scopedRows(req, client, { from, to }, [], true),
        compare === 'true' ? scopedRows(req, client, pp, [], true) : null,
      ]);
    } catch {
      return reply.status(502).send({ error: 'Keitaro не ответил' });
    }
    const who = await buyerResolver(req.user.ws, [...main, ...(prev || [])]);
    const byBuyer = (rows) => aggregate(rows, who, (r) => ({ buyer: who(r) })).sort((a, b) => b.profit - a.profit);
    const rows = byBuyer(main);
    if (!prev) return { rows, period: { from, to } };
    const before = new Map(byBuyer(prev).map(r => [r.buyer, r]));
    return {
      rows: rows.map(r => {
        const p = before.get(r.buyer);
        return { ...r, compare: p ? { profit_diff: r.profit - p.profit, cost_diff: r.cost - p.cost, roi_diff: r.roi != null && p.roi != null ? r.roi - p.roi : null, sales_diff: r.sales - p.sales } : null };
      }),
      period: { from, to }, compare_period: pp,
    };
  });

  // Query builder straight over Keitaro. Buyers get only their own campaigns.
  app.post('/query', auth, async (req, reply) => {
    const body = req.body || {};
    const { from, to } = body;
    if (!isDay(from) || !isDay(to)) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    if (from > to) return reply.status(400).send({ error: 'from позже to' });
    const cmp = compareRange(body, from, to);
    if (cmp?.error) return reply.status(400).send({ error: cmp.error });
    const dims = (Array.isArray(body.dimensions) ? body.dimensions : ['date']).filter(d => d === 'buyer' || own(DIM_MAP, d));
    const metrics = (Array.isArray(body.metrics) ? body.metrics : []).filter(m => METRICS.has(m));
    if (!dims.length) dims.push('date');
    if (!metrics.length) return reply.status(400).send({ error: 'Выберите хотя бы одну метрику' });
    const client = await keitaroFor(req, reply);
    if (!client) return;

    const hasBuyer = dims.includes('buyer');
    const grouping = [...new Set(dims.filter(d => d !== 'buyer').map(d => DIM_MAP[d]))];
    let raw, rawPrev = null;
    try {
      [raw, rawPrev] = await Promise.all([
        scopedRows(req, client, { from, to }, grouping, hasBuyer),
        cmp ? scopedRows(req, client, { from: cmp.from, to: cmp.to }, grouping, hasBuyer) : null,
      ]);
    } catch {
      return reply.status(502).send({ error: 'Keitaro не ответил' });
    }
    const who = hasBuyer ? await buyerResolver(req.user.ws, [...raw, ...(rawPrev || [])]) : null;
    const label = (r) => Object.fromEntries(dims.map(d => [d, d === 'buyer' ? who(r) : r[DIM_MAP[d]] ?? null]));
    const pick = (r) => Object.fromEntries([...dims.map(d => [d, r[d]]), ...metrics.map(m => [m, r[m]])]);
    let rows = aggregate(raw, (r) => JSON.stringify(label(r)), label).map(pick);
    const pickTotals = (r) => Object.fromEntries(metrics.map(m => [m, r[m]]));
    const totals = pickTotals(aggregate(raw, () => 'all', () => ({}))[0] || finish(Object.fromEntries(RAW.map(m => [m, 0]))));

    let comparison = null;
    if (cmp) {
      const prevTotals = pickTotals(aggregate(rawPrev, () => 'all', () => ({}))[0] || finish(Object.fromEntries(RAW.map(m => [m, 0]))));
      const changes = (cur, prev) => Object.fromEntries(metrics.map(m => [m, changeOf(cur[m], prev?.[m])]));
      // Rows match across periods by their non-time dimensions; a dated row has no counterpart in another period.
      const keyDims = dims.filter(d => !TIME_DIMS.has(d));
      const rowsComparable = keyDims.length === dims.length;
      if (rowsComparable) {
        const keyOf = (r) => JSON.stringify(keyDims.map(d => r[d]));
        const before = new Map(aggregate(rawPrev, (r) => JSON.stringify(label(r)), label).map(pick).map(r => [keyOf(r), r]));
        rows = rows.map(r => {
          const p = before.get(keyOf(r));
          return { ...r, compare: p ? pickTotals(p) : null, change: p ? changes(r, p) : null };
        });
      }
      comparison = { period: { from: cmp.from, to: cmp.to }, totals: prevTotals, change: changes(totals, prevTotals), rows_compared: rowsComparable };
    }

    const field = body.sort?.field;
    if (field && (dims.includes(field) || metrics.includes(field))) {
      const dir = body.sort.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const x = a[field], y = b[field];
        return typeof x === 'number' || typeof y === 'number' ? dir * ((Number(x) || 0) - (Number(y) || 0)) : dir * String(x ?? '').localeCompare(String(y ?? ''));
      });
    }
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);
    return { rows: rows.slice(0, limit), total: rows.length, totals, period: { from, to }, ...(comparison ? { compare: comparison } : {}) };
  });

  // Unified dashboard: Keitaro + FB + TikTok totals for a date range.
  app.get('/dashboard', auth, async (req) => {
    const { range = 'today' } = req.query;
    const { ws } = req.user;
    const now = new Date();
    const toISO = (d) => d.toISOString().slice(0, 10);
    let from, to;
    if (range === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = to = toISO(y);
    } else if (range === 'last_7_days') {
      const f = new Date(now); f.setDate(f.getDate() - 6);
      from = toISO(f); to = toISO(now);
    } else if (range === 'last_30_days') {
      const f = new Date(now); f.setDate(f.getDate() - 29);
      from = toISO(f); to = toISO(now);
    } else {
      from = to = toISO(now);
    }

    const result = {
      keitaro: { clicks: 0, conversions: 0, revenue: 0, cost: 0 },
      fb: { spend: 0, clicks: 0, impressions: 0, leads: 0 },
      tiktok: { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
      totals: { spend: 0, revenue: 0, profit: 0, roi: null },
      period: { from, to, range },
    };

    try {
      const wsData = await db.findOne('workspaces', { id: ws });
      if (wsData?.keitaro_url && wsData?.keitaro_api_key) {
        const client = keitaroClient(wsData.keitaro_url, wsData.keitaro_api_key);
        const scope = await buyerScope(req);
        const rawData = await client.stats({ from, to }, [], RAW);
        let rows = rawData?.rows || [];
        if (scope) rows = rows.filter(r => inScope(scope, r.campaign, r.campaign_group));
        const tot = rows.reduce((acc, r) => { for (const m of RAW) acc[m] += Number(r[m]) || 0; return acc; }, Object.fromEntries(RAW.map(m => [m, 0])));
        result.keitaro = { clicks: tot.clicks, conversions: tot.sales, revenue: tot.revenue, cost: tot.cost };
      }
    } catch { /* Keitaro unavailable */ }

    try {
      const { rows: fbRows } = await db.query(
        `SELECT COALESCE(SUM(spend),0) as spend, COALESCE(SUM(clicks),0) as clicks,
                COALESCE(SUM(impressions),0) as impressions, COALESCE(SUM(leads),0) as leads
         FROM campaigns WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2)
           AND DATE(created_at) BETWEEN $3 AND $4`,
        [ws, ownUser(req), from, to]
      );
      const fb = fbRows[0] || {};
      result.fb = { spend: Number(fb.spend)||0, clicks: Number(fb.clicks)||0, impressions: Number(fb.impressions)||0, leads: Number(fb.leads)||0 };
    } catch { /* FB data unavailable */ }

  // Real TikTok analytics via Marketing API
  try {
    const { rows: ttAccounts } = await db.query(
      `SELECT advertiser_id, access_token FROM tiktok_accounts WHERE workspace_id = $1 AND status = 'active'`,
      [ws]
    );

    let ttSpend = 0, ttClicks = 0, ttImpressions = 0, ttConversions = 0;

    for (const acc of ttAccounts) {
      try {
        const client = tiktokClient(acc.access_token);
        const statsResp = await client.getCampaignStats(acc.advertiser_id, { from, to });
        if (statsResp?.list) {
          for (const row of statsResp.list) {
            const m = row.metrics || {};
            ttSpend       += parseFloat(m.spend       || 0);
            ttClicks      += parseInt(m.clicks         || 0);
            ttImpressions += parseInt(m.impressions    || 0);
            ttConversions += parseInt(m.conversion     || 0);
          }
        }
      } catch { /* skip individual account errors */ }
    }

    result.tiktok = { spend: ttSpend, clicks: ttClicks, impressions: ttImpressions, conversions: ttConversions };
  } catch { /* TikTok data unavailable */ }

    const totalSpend = result.fb.spend + result.tiktok.spend + result.keitaro.cost;
    const revenue = result.keitaro.revenue;
    const profit = revenue - totalSpend;
    result.totals = { spend: totalSpend, revenue, profit, roi: totalSpend > 0 ? profit / totalSpend * 100 : null };

    return result;
  });
}

