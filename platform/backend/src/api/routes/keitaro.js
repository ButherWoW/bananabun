import { adminOnly } from '../../middleware/access.js';
import { db } from '../../db/client.js';
import { keitaroClient } from '../../services/keitaro.js';

// FA-style names carry the buyer in the 3rd bracket: [hash][date][izya(723604)][…]; older ones: [Buyer] Product.
export function campaignBuyerTag(name = '') {
  const segs = [...(String(name).match(/^(\[[^\]]*\])+/)?.[0] || '').matchAll(/\[([^\]]*)\]/g)].map(m => m[1]);
  const raw = segs.length >= 6 ? segs[2] : segs[0];
  return (raw || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

// A buyer's campaign: its name tag or its Keitaro campaign group matches one of the buyer's tags.
export function inScope(scope, name, groupName) {
  return scope.has(campaignBuyerTag(name)) || scope.has(String(groupName || '').replace(/^\[|\]$/g, '').trim().toLowerCase());
}

// Owner/lead see every campaign; a buyer only those tagged with their Keitaro nickname (set by the owner).
export async function buyerScope(req) {
  if (req.user.role !== 'buyer') return null;
  const { rows: [u] } = await db.query('SELECT keitaro_tag FROM users WHERE id = $1', [req.user.id]);
  const tags = String(u?.keitaro_tag || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  return new Set(tags);
}

// Same rule as the lists: name tag or Keitaro campaign group.
async function buyerOwnsCampaign(client, scope, id) {
  const campaign = await client.campaign(id).catch(() => null);
  if (!campaign) return false;
  const groups = await client.groups().catch(() => []);
  const groupName = (Array.isArray(groups) ? groups : []).find(g => g.id === campaign.group_id)?.name;
  return inScope(scope, campaign.name, groupName);
}

// Real spend from the FB cabinets read by the agent, instead of Keitaro's estimated cost.
// Keitaro campaign → FB campaigns through sub_id_2; only periods we store FB spend for.
const FB_SPEND_COL = { today: 'spend_today', yesterday: 'spend_yesterday', last_3_days: 'spend_3d', last_7_days: 'spend_7d', last_30_days: 'spend_30d' };
async function withFbSpend(client, ws, range, rows) {
  const col = FB_SPEND_COL[range];
  for (const r of rows) r.spend_source = 'keitaro';
  if (!col || !rows.length) return;
  const map = await client.stats(range, ['campaign_id', 'sub_id_2'], ['clicks']).catch(() => null);
  const fbIds = new Map();
  for (const m of map?.rows || []) {
    const fb = String(m.sub_id_2 || '');
    if (!/^\d+$/.test(fb)) continue;
    const k = String(m.campaign_id);
    if (!fbIds.has(k)) fbIds.set(k, new Set());
    fbIds.get(k).add(fb);
  }
  const all = [...new Set([...fbIds.values()].flatMap(s => [...s]))];
  if (!all.length) return;
  const { rows: fb } = await db.query(
    `SELECT id, ${col} AS spend, currency, synced_at FROM fb_campaigns WHERE workspace_id = $1 AND id = ANY($2)`, [ws, all]);
  const byId = new Map(fb.map(f => [String(f.id), f]));
  // An FB campaign seen under two Keitaro campaigns can't be split between them.
  const owners = new Map();
  for (const [k, set] of fbIds) for (const id of set) owners.set(id, (owners.get(id) || 0) + 1);
  const trackerCurrency = (process.env.KEITARO_CURRENCY || 'USD').toUpperCase();
  for (const r of rows) {
    const ids = [...(fbIds.get(String(r.campaign_id)) || [])];
    const known = ids.map(id => byId.get(id)).filter(Boolean);
    if (!known.length) continue;
    // Replace only a complete, single-currency, unshared picture; otherwise keep Keitaro's cost and say why.
    const currencies = new Set(known.map(f => String(f.currency || '').toUpperCase()));
    const why = known.length < ids.length ? 'не все FB-кампании прочитаны'
      : known.some(f => f.spend === null || f.spend === undefined) ? 'расход FB за этот период ещё не прочитан агентом'
      : ids.some(id => owners.get(id) > 1) ? 'FB-кампания в нескольких кампаниях Keitaro'
      : currencies.size !== 1 || !currencies.has(trackerCurrency) ? 'валюта кабинета не совпадает с Keitaro' : null;
    if (why) { r.spend_note = why; continue; }
    r.keitaro_cost = Number(r.cost) || 0;
    r.cost = known.reduce((s, f) => s + (Number(f.spend) || 0), 0);
    r.profit = (Number(r.revenue) || 0) - r.cost;
    r.roi = r.cost ? r.profit / r.cost * 100 : null;
    r.spend_source = 'fb';
    r.fb_synced_at = known.map(f => f.synced_at).filter(Boolean).sort()[0] || null;
    r.fb_currency = known[0].currency || null;
  }
}

async function getClient(wsId) {
  const ws = await db.findOne('workspaces', { id: wsId });
  if (!ws?.keitaro_url || !ws?.keitaro_api_key) throw new Error('Keitaro не настроен');
  return keitaroClient(ws.keitaro_url, ws.keitaro_api_key);
}

export async function keitaroRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // GET stats for a period
  app.get('/stats', auth, async (req) => {
    const { range = 'today', from, to } = req.query;
    const client = await getClient(req.user.ws);
    const r = from && to ? { from, to } : range;
    const scope = await buyerScope(req);
    const data = await client.stats(r, ['campaign_id', 'campaign', ...(scope ? ['campaign_group'] : [])],
      ['clicks', 'lp_clicks', 'conversions', 'sales', 'leads', 'revenue', 'cost', 'profit', 'roi']);
    let rows = data?.rows || [];
    if (scope) rows = rows.filter(row => inScope(scope, row.campaign, row.campaign_group));
    await withFbSpend(client, req.user.ws, from && to ? null : range, rows);
    return { rows, total: rows.length };
  });

  // GET stats by day (for charts)
  app.get('/stats/daily', auth, async (req) => {
    const { days = 30 } = req.query;
    const client = await getClient(req.user.ws);
    const metrics = ['clicks', 'conversions', 'revenue', 'cost'];
    const scope = await buyerScope(req);
    if (!scope) return client.stats(`last_${days}_days`, ['day'], metrics);
    const data = await client.stats(`last_${days}_days`, ['day', 'campaign', 'campaign_group'], metrics);
    const byDay = new Map();
    for (const row of data?.rows || []) {
      if (!inScope(scope, row.campaign, row.campaign_group)) continue;
      const acc = byDay.get(row.day) || { day: row.day, clicks: 0, conversions: 0, revenue: 0, cost: 0 };
      for (const m of metrics) acc[m] += Number(row[m]) || 0;
      byDay.set(row.day, acc);
    }
    const rows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return { rows, total: rows.length };
  });

  // GET list of Keitaro campaigns
  app.get('/campaigns', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const scope = await buyerScope(req);
    if (!scope) return client.allCampaigns();
    if (!scope.size) return [];
    const [all, groups] = await Promise.all([client.allCampaigns(), client.groups().catch(() => [])]);
    const groupName = new Map((Array.isArray(groups) ? groups : []).map(g => [g.id, g.name]));
    return all.filter(c => inScope(scope, c.name, groupName.get(c.group_id)));
  });

  // Deleted campaigns for the «Архив» tab (Keitaro keeps them out of the main list).
  app.get('/campaigns/deleted', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const scope = await buyerScope(req);
    const all = (await client.deletedCampaigns().catch(() => [])) || [];
    const list = (Array.isArray(all) ? all : []).map(c => ({ ...c, state: 'deleted' }));
    if (!scope) return list;
    if (!scope.size) return [];
    const groups = await client.groups().catch(() => []);
    const groupName = new Map((Array.isArray(groups) ? groups : []).map(g => [g.id, g.name]));
    return list.filter(c => inScope(scope, c.name, groupName.get(c.group_id)));
  });

  // GET/PUT workspace Keitaro settings
  app.get('/settings', auth, async (req) => {
    const ws = await db.findOne('workspaces', { id: req.user.ws });
    return {
      keitaro_url: ws.keitaro_url || '',
      keitaro_api_key: ws.keitaro_api_key ? '***' : '',
      keitaro_group_id: ws.keitaro_group_id || null,
      keitaro_domain_id: ws.keitaro_domain_id || null,
      keitaro_offer_ids: Array.isArray(ws.keitaro_offer_ids) ? ws.keitaro_offer_ids : [],
      keitaro_white_id: ws.keitaro_white_id || null,
    };
  });

  // An empty or masked key keeps the saved one; an empty URL is refused (it would cut Keitaro off).
  app.put('/settings', adminOnly(app), async (req, reply) => {
    const url = String(req.body?.keitaro_url || '').trim();
    if (!/^https:\/\/[^/\s]+/.test(url)) return reply.status(400).send({ error: 'Укажите https-адрес Keitaro' });
    const key = String(req.body?.keitaro_api_key || '').trim();

    const updates = {
      keitaro_url: url,
      ...(key && key !== '***' ? { keitaro_api_key: key } : {}),
    };
    if (req.body?.keitaro_group_id !== undefined) updates.keitaro_group_id = Number(req.body.keitaro_group_id) || null;
    if (req.body?.keitaro_domain_id !== undefined) updates.keitaro_domain_id = Number(req.body.keitaro_domain_id) || null;
    if (req.body?.keitaro_offer_ids !== undefined) {
      const ids = Array.isArray(req.body.keitaro_offer_ids) ? req.body.keitaro_offer_ids : [];
      updates.keitaro_offer_ids = JSON.stringify(ids.map(Number).filter(Boolean));
    }
    if (req.body?.keitaro_white_id !== undefined) updates.keitaro_white_id = Number(req.body.keitaro_white_id) || null;

    await db.query(
      `UPDATE workspaces SET keitaro_url=$1, keitaro_api_key=COALESCE($2, keitaro_api_key),
        keitaro_group_id=$3, keitaro_domain_id=$4, keitaro_offer_ids=$5::jsonb, keitaro_white_id=$6
       WHERE id=$7`,
      [
        updates.keitaro_url,
        updates.keitaro_api_key || null,
        updates.keitaro_group_id ?? null,
        updates.keitaro_domain_id ?? null,
        updates.keitaro_offer_ids ?? '[]',
        updates.keitaro_white_id ?? null,
        req.user.ws,
      ]
    );
    return { ok: true };
  });

  // GET landing pages from Keitaro
  app.get('/landings', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const data = await client.landingPages();
    return data;
  });

  // GET landing templates (from FA template group in Keitaro)
  app.get('/landing-templates', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const all = await client.landingPages();
    const pages = Array.isArray(all) ? all : (all?.rows || []);
    // Filter to FA template groups + all landing pages grouped
    const templates = pages.filter(p =>
      p.group_id || p.group || p.type === 'html' || true
    );
    return templates;
  });

  // GET domains from Keitaro
  app.get('/domains', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const data = await client.domains();
    return data;
  });

  // GET offers from Keitaro
  app.get('/offers', auth, async (req) => {
    const client = await getClient(req.user.ws);
    const data = await client.offers();
    return Array.isArray(data) ? data : [];
  });

  // GET groups from Keitaro
  app.get('/groups', auth, async (req) => {
    const client = await getClient(req.user.ws);
    try {
      const data = await client.groups();
      return Array.isArray(data) ? data : [];
    } catch {
      // Fallback: extract groups from campaign names
      const campaigns = await client.campaigns(500);
      const groups = new Map();
      for (const c of campaigns) {
        const m = c.name?.match(/^\[([^\]]+)\]/);
        if (m) groups.set(m[1], { id: m[1], name: m[1] });
        if (c.group_id && c.group_name) groups.set(c.group_id, { id: c.group_id, name: c.group_name });
      }
      return [...groups.values()];
    }
  });

  // SET campaign state (active/disabled/deleted)
  app.put('/campaigns/:id/state', auth, async (req, reply) => {
    const { state } = req.body || {};
    if (!['active', 'disabled'].includes(state) && req.user.role === 'buyer') {
      return reply.status(403).send({ error: 'Баер может только включать и выключать кампании' });
    }
    const client = await getClient(req.user.ws);
    const scope = await buyerScope(req);
    if (scope) {
      if (!scope.size) return reply.status(403).send({ error: 'Владелец не указал твой ник в Keitaro — попроси его в разделе «Команда»' });
      if (!(await buyerOwnsCampaign(client, scope, req.params.id))) {
        return reply.status(403).send({ error: 'Это не твоя кампания' });
      }
    }
    return client.setCampaignState(req.params.id, state);
  });

  // GET streams for a campaign (drill-down)
  app.get('/campaigns/:id/streams', auth, async (req, reply) => {
    const client = await getClient(req.user.ws);
    const scope = await buyerScope(req);
    if (scope && !(await buyerOwnsCampaign(client, scope, req.params.id))) return reply.status(403).send({ error: 'Это не твоя кампания' });
    try {
      const data = await client.campaignStreams(req.params.id);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  });

  // Test connection
  // Owner/lead only, https only: otherwise any member could make the server fetch internal URLs.
  app.post('/test', adminOnly(app), async (req, reply) => {
    const keitaro_url = String(req.body?.keitaro_url || '').trim();
    if (!/^https:\/\/[^/\s]+/.test(keitaro_url)) return reply.status(400).send({ error: 'Укажите https-адрес Keitaro' });
    const sent = String(req.body?.keitaro_api_key || '').trim();
    // The saved key is only ever sent to the saved address.
    const saved = await db.findOne('workspaces', { id: req.user.ws });
    const keitaro_api_key = sent && sent !== '***' ? sent : (saved?.keitaro_url === keitaro_url ? saved.keitaro_api_key : null);
    if (!keitaro_api_key) return reply.status(400).send({ error: 'Введите API-ключ для этого адреса' });
    const client = keitaroClient(keitaro_url, keitaro_api_key);
    const data = await client.campaigns(1);
    return { ok: true, campaigns_count: data.length };
  });
}
