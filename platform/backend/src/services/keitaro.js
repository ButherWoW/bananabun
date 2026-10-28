function isoDate(d) { return d.toISOString().slice(0, 10); }

// Map range alias → Keitaro {from, to} date range
function toKeitaroRange(range) {
  const now = new Date();
  const today = isoDate(now);

  const yday = new Date(now); yday.setDate(yday.getDate() - 1);
  const yesterday = isoDate(yday);

  // Named intervals follow the Keitaro instance timezone; server-side UTC dates shift the day.
  if (range === 'today') return { interval: 'today' };
  if (range === 'yesterday') return { interval: 'yesterday' };

  // last N days
  const m = typeof range === 'string' && range.match(/^last[_ ](\d+)[_ ]days?$/);
  if (m) {
    const d = new Date(now); d.setDate(d.getDate() - parseInt(m[1]) + 1);
    return { from: isoDate(d), to: today };
  }

  // If already an object with from/to, pass through
  if (typeof range === 'object') return range;

  // Fallback: today
  return { from: today, to: today };
}

export function keitaroClient(baseUrl, apiKey) {
  const base = baseUrl.replace(/\/$/, '') + '/admin_api/v1';
  const headers = {
    'Api-Key': apiKey,
    'User-Agent': 'Mozilla/5.0',
    'Content-Type': 'application/json',
  };

  async function req(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Keitaro ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    stats(range = 'today', grouping = ['campaign'], metrics = ['clicks', 'conversions', 'revenue', 'cost']) {
      const r = toKeitaroRange(range);
      return req('POST', '/report/build', { range: r, grouping, metrics, filters: [] });
    },
    campaigns(limit = 200) {
      return req('GET', `/campaigns?limit=${limit}`);
    },
    // Keitaro caps one page; walk offsets so owner checks see every campaign.
    async allCampaigns(pageSize = 500, max = 10000) {
      const all = [];
      for (let offset = 0; offset < max; offset += pageSize) {
        const page = await req('GET', `/campaigns?limit=${pageSize}&offset=${offset}`);
        const rows = Array.isArray(page) ? page : (page?.rows || []);
        all.push(...rows);
        if (rows.length < pageSize) break;
      }
      return all;
    },
    deletedCampaigns() {
      return req('GET', '/campaigns/deleted');
    },
    campaign(id) {
      return req('GET', `/campaigns/${encodeURIComponent(id)}`);
    },
    createCampaign(data) {
      return req('POST', '/campaigns', data);
    },
    createStream(data) {
      return req('POST', '/streams', data);
    },
    deleteCampaign(id) {
      return req('DELETE', `/campaigns/${id}`);
    },
    landingPages() {
      return req('GET', '/landing_pages?limit=500');
    },
    domains() {
      return req('GET', '/domains');
    },
    groups(type = 'campaigns') {
      return req('GET', `/groups?type=${type}`);
    },
    campaignsFull(limit = 500) {
      return req('GET', `/campaigns?limit=${limit}&expand=group`);
    },
    offers(limit = 500) {
      return req('GET', `/offers?limit=${limit}`);
    },
    setCampaignState(id, state) {
      return req('PUT', `/campaigns/${id}`, { state });
    },
    archiveCampaign(id) {
      return req('PUT', `/campaigns/${id}`, { state: 'deleted' });
    },
    campaignStreams(campaignId) {
      return req('GET', `/campaigns/${campaignId}/streams`);
    },
    createLanding(name, content) {
      return req('POST', '/landing_pages', { name, content_type: 'html', content });
    },
  };
}
