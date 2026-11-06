import { db } from '../../db/client.js';
import { landingFunnel, landingBehavior } from '../../services/lp-analytics.js';
import { keitaroClient } from '../../services/keitaro.js';
import { tiktokClient } from '../../services/tiktok.js';
import { buyerScope, inScope } from './keitaro.js';
import { buyerNamer, buyerShare, BUYER_SHARE_PCT, TRACKER_CURRENCY } from '../../services/buyers.js';
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

// Buyer of a Keitaro row (grouped with sub_id_2): one shared rule, see services/buyers.js.
const buyerResolver = (ws, rows) => buyerNamer(ws, rows);

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

    // The old `campaigns` table is empty since the move off FA. The live source is fb_campaigns (read from the
    // cabinets through the agent), which keeps only today's and yesterday's spend, no history, revenue or clicks:
    // those are null rather than invented. Spend is in the cabinet's currency, so rows are split by currency.
    // Buyers see campaigns of their AdsPower group only; `days` can only cut off the two days kept (days = 1 → today).
    const group = req.user.role === 'buyer' ? String(req.user.email || '').toLowerCase() : null;
    const { rows } = await db.query(
      `SELECT UPPER(COALESCE(c.currency, '')) AS currency, SUM(c.spend_today) AS today, SUM(c.spend_yesterday) AS yesterday
         FROM fb_campaigns c JOIN fb_accounts fa ON fa.id = c.fb_account_id
         LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
        WHERE c.workspace_id = $1 AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)
        GROUP BY 1 ORDER BY 1`,
      [ws, group]
    );
    const day = (offset) => new Date(Date.now() - offset * 86400e3).toISOString().slice(0, 10);
    const out = [];
    for (const [offset, col] of [[1, 'yesterday'], [0, 'today']]) {
      if (offset >= days) continue;
      for (const r of rows) {
        if (r[col] === null || r[col] === undefined) continue;
        out.push({ date: day(offset), currency: r.currency || null, spend: Number(r[col]), revenue: null, roi: null, clicks: null });
      }
    }
    // No data is shown as no data — never as made-up numbers.
    return out;
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
    const extra = [...(needBuyer ? ['sub_id_2', 'campaign', 'campaign_group'] : []), ...(scope ? ['campaign', 'campaign_group'] : [])];
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
    const byBuyer = (rows) => aggregate(rows, who, (r) => ({ buyer: who(r) }))
      .map(r => ({ ...r, buyer_share: buyerShare(r.profit) })).sort((a, b) => b.profit - a.profit);
    const rows = byBuyer(main);
    const meta = { currency: TRACKER_CURRENCY, buyer_share_pct: BUYER_SHARE_PCT };
    if (!prev) return { rows, period: { from, to }, ...meta };
    const before = new Map(byBuyer(prev).map(r => [r.buyer, r]));
    return {
      rows: rows.map(r => {
        const p = before.get(r.buyer);
        return { ...r, compare: p ? { profit_diff: r.profit - p.profit, cost_diff: r.cost - p.cost, roi_diff: r.roi != null && p.roi != null ? r.roi - p.roi : null, sales_diff: r.sales - p.sales } : null };
      }),
      period: { from, to }, compare_period: pp, ...meta,
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
    return { rows: rows.slice(0, limit), total: rows.length, totals, currency: TRACKER_CURRENCY, period: { from, to }, ...(comparison ? { compare: comparison } : {}) };
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

    const cur = TRACKER_CURRENCY;
    const result = {
      currency: cur,
      keitaro: { clicks: 0, conversions: 0, revenue: 0, cost: 0 },
      tiktok: { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
      totals: { spend: 0, revenue: 0, profit: 0, roi: null },
      period: { from, to, range },
    };

    // Spend is the tracker's cost: the Facebook spend read from the cabinets is not reliable enough for the dashboard
    // (owner's decision, 31.10), so it is neither shown nor added. Amounts are never converted.
    let keitaroCounted = 0;
    try {
      const wsData = await db.findOne('workspaces', { id: ws });
      if (wsData?.keitaro_url && wsData?.keitaro_api_key) {
        const client = keitaroClient(wsData.keitaro_url, wsData.keitaro_api_key);
        const rows = await scopedRows(req, client, { from, to }, ['sub_id_2'], false);
        const tot = Object.fromEntries(RAW.map(m => [m, 0]));
        for (const r of rows) for (const m of RAW) tot[m] += Number(r[m]) || 0;
        keitaroCounted = tot.cost;
        result.keitaro = { clicks: tot.clicks, conversions: tot.sales, revenue: tot.revenue, cost: tot.cost, cost_counted: keitaroCounted };
      }
    } catch { /* Keitaro unavailable */ }
    delete result.fb;
    const addOther = (bucket, ccy, v) => { bucket[ccy] = Math.round(((bucket[ccy] || 0) + v) * 100) / 100; };

    // TikTok via the Marketing API. A buyer gets only campaigns created by their own TikTok pushes.
    try {
      const buyer = req.user.role === 'buyer';
      let mine = null;
      if (buyer) {
        const { rows } = await db.query(
          `SELECT DISTINCT params->>'tiktok_account_id' AS acc, params->>'campaign_id' AS campaign_id FROM pushes
            WHERE workspace_id = $1 AND created_by = $2 AND params->>'tiktok' = 'true' AND params->>'campaign_id' IS NOT NULL`,
          [ws, req.user.id]);
        mine = { accounts: [...new Set(rows.map(r => r.acc))], campaigns: new Set(rows.map(r => String(r.campaign_id))) };
      }
      const { rows: ttAccounts } = mine && !mine.accounts.length ? { rows: [] } : await db.query(
        `SELECT advertiser_id, access_token, UPPER(COALESCE(currency, '')) AS currency FROM tiktok_accounts
          WHERE workspace_id = $1 AND status = 'active' AND ($2::text[] IS NULL OR id = ANY($2))`,
        [ws, mine ? mine.accounts : null]);

      let ttSpend = 0, ttClicks = 0, ttImpressions = 0, ttConversions = 0;
      const ttOther = {};
      for (const acc of ttAccounts) {
        const sameCcy = !acc.currency || acc.currency === cur;
        try {
          const statsResp = await tiktokClient(acc.access_token).getCampaignStats(acc.advertiser_id, { from, to });
          for (const row of statsResp?.list || []) {
            if (mine && !mine.campaigns.has(String(row.dimensions?.campaign_id))) continue;
            const m = row.metrics || {};
            if (sameCcy) ttSpend += parseFloat(m.spend || 0); else addOther(ttOther, acc.currency, parseFloat(m.spend || 0));
            ttClicks      += parseInt(m.clicks         || 0);
            ttImpressions += parseInt(m.impressions    || 0);
            ttConversions += parseInt(m.conversion     || 0);
          }
        } catch { /* skip individual account errors */ }
      }
      result.tiktok = { spend: ttSpend, clicks: ttClicks, impressions: ttImpressions, conversions: ttConversions, other_currency: ttOther };
    } catch { /* TikTok data unavailable */ }

    const totalSpend = result.tiktok.spend + keitaroCounted;
    const revenue = result.keitaro.revenue;
    const profit = revenue - totalSpend;
    const otherCurrency = {};
    for (const [c, v] of Object.entries(result.tiktok.other_currency || {})) otherCurrency[c] = Math.round(((otherCurrency[c] || 0) + v) * 100) / 100;
    result.totals = { spend: totalSpend, revenue, profit, roi: totalSpend > 0 ? profit / totalSpend * 100 : null, currency: cur, other_currency: otherCurrency };

    return result;
  });
}

