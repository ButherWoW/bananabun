import { db } from '../../db/client.js';
import { faAnalyticsQuery, faAvailable } from '../../services/fa-client.js';
import { landingFunnel, landingBehavior } from '../../services/lp-analytics.js';
import { keitaroClient } from '../../services/keitaro.js';

// Keitaro dimension names for our query builder
const DIM_MAP = {
  date: 'day', day: 'day', week: 'week', month: 'month',
  campaign: 'campaign_id', geo: 'country', country: 'country',
  device: 'device_type', os: 'os', browser: 'browser',
  language: 'language', offer: 'sub_id_3', adset: 'sub_id_4',
  landing: 'sub_id_5', ad: 'sub_id_6',
};
// Metrics Keitaro returns natively; others are computed below
const METRIC_MAP = {
  clicks: 'clicks', impressions: 'impressions', spend: 'cost', cost: 'cost',
  revenue: 'revenue', leads: 'leads', sales: 'conversions', conversions: 'conversions',
  profit: 'profit', roi: 'roi', cr: 'cr', lp_views: 'lp_clicks', lp_ctr: 'lp_ctr',
};
// Metrics computed from raw numbers after the query
const COMPUTED = new Set(['cpc', 'cpm', 'ctr', 'cpa', 'roas', 'epc']);

function computeRow(row, wantComputed) {
  for (const m of wantComputed) {
    const cl = Number(row.clicks || 0), cost = Number(row.cost || 0),
      rev = Number(row.revenue || 0), imp = Number(row.impressions || 0),
      conv = Number(row.conversions || 0);
    if (m === 'cpc') row.cpc = cl > 0 ? cost / cl : null;
    if (m === 'cpm') row.cpm = imp > 0 ? cost / imp * 1000 : null;
    if (m === 'ctr') row.ctr = imp > 0 ? cl / imp * 100 : null;
    if (m === 'cpa') row.cpa = conv > 0 ? cost / conv : null;
    if (m === 'roas') row.roas = cost > 0 ? rev / cost : null;
    if (m === 'epc') row.epc = cl > 0 ? rev / cl : null;
  }
  return row;
}

// Previous period of the same length
function prevPeriod(from, to) {
  const f = new Date(from), t = new Date(to);
  const days = Math.round((t - f) / 86400000) + 1;
  const pf = new Date(f); pf.setDate(pf.getDate() - days);
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
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

    const [{ rows: [{ count: products_count }] }, { rows: [{ count: creatives_count }] }, { rows: campaigns }, campaigns_count] =
      await Promise.all([
        db.query('SELECT COUNT(*) FROM products WHERE workspace_id = $1', [ws]),
        db.query('SELECT COUNT(*) FROM creatives WHERE workspace_id = $1', [ws]),
        db.query('SELECT spend, revenue FROM campaigns WHERE workspace_id = $1', [ws]),
        db.query('SELECT COUNT(*) FROM campaigns WHERE workspace_id = $1', [ws]),
      ]);

    const total_spend = campaigns.reduce((s, c) => s + Number(c.spend || 0), 0);
    const total_revenue = campaigns.reduce((s, c) => s + Number(c.revenue || 0), 0);
    const roi = total_spend > 0 ? total_revenue / total_spend : 0;

    return {
      total_spend,
      total_revenue,
      roi,
      products_count: Number(products_count),
      creatives_count: Number(creatives_count),
      campaigns_count: Number(campaigns_count.rows[0].count),
    };
  });

  app.get('/daily', auth, async (req) => {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const { ws } = req.user;

    // Try to get real data from campaigns
    const { rows } = await db.query(
      `SELECT DATE(created_at) as date, SUM(spend) as spend, SUM(revenue) as revenue, SUM(clicks) as clicks
       FROM campaigns WHERE workspace_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at) ORDER BY date`,
      [ws]
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
    const { from, to, campaign, top } = req.query;
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    return landingBehavior(req.user, { from, to, campaigns: campaignList(campaign), top: Math.min(Number(top) || 8, 30) });
  });

  app.post('/fa-query', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(503).send({ error: 'FA не настроен' });
    if (!req.body?.plan) return reply.status(400).send({ error: 'Нужен план запроса' });
    try {
      return await faAnalyticsQuery(req.body.plan, req.body.compare_range);
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // Buyer stats from Keitaro + our pushes table (no FA dependency).
  app.get('/buyers', auth, async (req, reply) => {
    const { from, to, compare } = req.query;
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    const ws = await db.findOne('workspaces', { id: req.user.ws });
    if (!ws?.keitaro_url || !ws?.keitaro_api_key) return reply.status(503).send({ error: 'Keitaro не настроен' });
    const client = keitaroClient(ws.keitaro_url, ws.keitaro_api_key);

    const KM = ['clicks', 'conversions', 'revenue', 'cost', 'profit', 'roi', 'cr'];
    const [mainData, prevData] = await Promise.all([
      client.stats({ from, to }, ['sub_id_2', 'campaign_id'], KM),
      compare === 'true' ? client.stats(prevPeriod(from, to), ['sub_id_2', 'campaign_id'], KM) : null,
    ]);

    // campaign_id (sub_id_2) → buyer name: first try our pushes, then campaign name tag
    const allIds = [...new Set((mainData?.rows || []).map(r => String(r.sub_id_2 || '')).filter(Boolean))];
    const { rows: pushRows } = allIds.length
      ? await db.query(
          `SELECT p.fb_campaign_id, u.email, u.display_name
             FROM pushes p JOIN users u ON u.id = p.created_by
            WHERE p.workspace_id = $1 AND p.fb_campaign_id = ANY($2)`,
          [req.user.ws, allIds])
      : { rows: [] };
    const byId = new Map(pushRows.map(r => [String(r.fb_campaign_id), r.display_name || r.email?.split('@')[0] || '?']));

    // Group by buyer
    function aggregate(rows) {
      const map = new Map();
      for (const r of rows || []) {
        const buyer = byId.get(String(r.sub_id_2 || '')) || buyerTag(r.campaign_id) || 'unknown';
        const acc = map.get(buyer) || { buyer, clicks: 0, sales: 0, cost: 0, revenue: 0, profit: 0, _roi_sum: 0, _n: 0 };
        acc.clicks += Number(r.clicks || 0);
        acc.sales += Number(r.conversions || 0);
        acc.cost += Number(r.cost || 0);
        acc.revenue += Number(r.revenue || 0);
        acc.profit += Number(r.profit || 0);
        acc._roi_sum += Number(r.roi || 0);
        acc._n += 1;
        map.set(buyer, acc);
      }
      return [...map.values()].map(r => {
        const cr = r.clicks > 0 ? r.sales / r.clicks * 100 : 0;
        const roi = r.cost > 0 ? r.profit / r.cost * 100 : 0;
        delete r._roi_sum; delete r._n;
        return { ...r, cr: parseFloat(cr.toFixed(2)), roi: parseFloat(roi.toFixed(2)) };
      }).sort((a, b) => b.profit - a.profit);
    }

    const main = aggregate(mainData?.rows);
    if (!prevData) return { rows: main, period: { from, to } };

    const prev = aggregate(prevData?.rows);
    const prevMap = new Map(prev.map(r => [r.buyer, r]));
    const rows = main.map(r => {
      const p = prevMap.get(r.buyer);
      return { ...r, compare: p ? { profit_diff: parseFloat((r.profit - p.profit).toFixed(2)), cost_diff: parseFloat((r.cost - p.cost).toFixed(2)), roi_diff: parseFloat((r.roi - p.roi).toFixed(2)), sales_diff: r.sales - p.sales } : null };
    });
    const pp = prevPeriod(from, to);
    return { rows, period: { from, to }, compare_period: pp };
  });

  // Flexible analytics query builder — Keitaro directly, no FA.
  app.post('/query', auth, async (req, reply) => {
    const { from, to, dimensions = ['date'], metrics = ['clicks', 'spend', 'revenue', 'profit', 'roi'], sort, limit = 50 } = req.body || {};
    if (!DAY.test(from || '') || !DAY.test(to || '')) return reply.status(400).send({ error: 'from и to — даты YYYY-MM-DD' });
    const ws = await db.findOne('workspaces', { id: req.user.ws });
    if (!ws?.keitaro_url || !ws?.keitaro_api_key) return reply.status(503).send({ error: 'Keitaro не настроен' });
    const client = keitaroClient(ws.keitaro_url, ws.keitaro_api_key);

    const hasBuyer = dimensions.includes('buyer');
    // Map dimensions to Keitaro groupings; 'buyer' needs sub_id_2 + campaign
    const grouping = [...new Set([
      ...(hasBuyer ? ['sub_id_2', 'campaign_id'] : []),
      ...dimensions.filter(d => d !== 'buyer').map(d => DIM_MAP[d]).filter(Boolean),
    ])];
    if (!grouping.length) grouping.push('day');

    // Metrics: split native vs computed
    const wantComputed = metrics.filter(m => COMPUTED.has(m));
    const nativeMetrics = [...new Set([
      ...metrics.filter(m => METRIC_MAP[m]).map(m => METRIC_MAP[m]),
      ...(wantComputed.length ? ['clicks', 'cost', 'revenue', 'impressions', 'conversions'] : []),
    ])];

    const data = await client.stats({ from, to }, grouping, nativeMetrics);
    let rows = (data?.rows || []).map(r => {
      // Rename Keitaro fields back to our names
      const out = {};
      if (hasBuyer) out.buyer = r.sub_id_2 ? (r.sub_id_2 + '') : (buyerTag(r.campaign_id) || 'unknown');
      for (const d of dimensions.filter(d => d !== 'buyer')) {
        const kd = DIM_MAP[d];
        out[d] = kd ? r[kd] : r[d];
      }
      for (const m of metrics.filter(m => METRIC_MAP[m])) {
        const km = METRIC_MAP[m];
        out[m] = Number(r[km] ?? 0);
        if (m !== km) delete out[km];
      }
      computeRow(out, wantComputed);
      return out;
    });

    // Sort
    if (sort?.field && rows.length) {
      const dir = sort.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => dir * ((Number(a[sort.field]) || 0) - (Number(b[sort.field]) || 0)));
    }
    rows = rows.slice(0, Math.min(Number(limit) || 50, 500));
    return { rows, total: rows.length, period: { from, to } };
  });
}
