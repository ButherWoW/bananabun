/**
 * Client for the original FA platform.
 * FA's /api/* is behind Cloudflare Access; only /mcp is reachable with an agent token,
 * so every call goes through MCP tools (JSON-RPC over streamable HTTP).
 */

const FA_MCP_URL = process.env.FA_MCP_URL || 'https://app.fuckingaffiliateplatform.com/mcp';
const FA_APP_URL = new URL(FA_MCP_URL).origin;
const FA_TOKEN = process.env.FA_AGENT_TOKEN;
const FA_WS_ID = process.env.FA_WORKSPACE_ID || process.env.FA_WORKSPACE || 'ws_76b3003056c54172aa76cff8';
// Optional Cloudflare Access service token: needed only to download FA images.
const CF_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

export const faAvailable = () => !!FA_TOKEN;
export const faImagesAvailable = () => !!(CF_ID && CF_SECRET);

class FaError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

let sessionId = null;
let rpcId = 0;

async function rpc(method, params, { notify = false } = {}) {
  if (!FA_TOKEN) throw new FaError('FA не настроен: нет FA_AGENT_TOKEN');
  const res = await fetch(FA_MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FA_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (notify) return null;

  const text = await res.text();
  if (res.status === 401) throw new FaError('FA отклонил токен агента (401) — нужен действующий FA_AGENT_TOKEN');
  if (res.status === 404 && sessionId) { sessionId = null; throw new FaError('session_expired'); }
  if (!res.ok) throw new FaError(`FA ${res.status}: ${text.slice(0, 200)}`);

  // Streamable HTTP may answer with plain JSON or with an SSE stream of `data:` lines.
  const payloads = (res.headers.get('content-type') || '').includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean)
    : [text];
  for (const p of payloads) {
    const msg = JSON.parse(p);
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      if (msg.error) throw new FaError(`FA: ${msg.error.message || JSON.stringify(msg.error)}`);
      return msg.result;
    }
  }
  throw new FaError('FA: пустой ответ MCP');
}

async function ensureSession() {
  if (sessionId) return;
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bananabun', version: '1.0' },
  });
  await rpc('notifications/initialized', {}, { notify: true });
}

/** Call an FA tool and return its parsed JSON payload. */
export async function faTool(name, args = {}) {
  const withWs = { workspace_id: FA_WS_ID, ...args };
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureSession();
    try {
      const result = await rpc('tools/call', { name, arguments: withWs });
      const text = (result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      let data;
      try { data = JSON.parse(text); } catch { data = { text }; }
      if (result?.isError) throw new FaError(data?.detail || data?.title || data?.text || `FA ${name}: ошибка`, data);
      return data;
    } catch (e) {
      if (e.message === 'session_expired' && attempt === 0) continue;
      throw e;
    }
  }
}

/**
 * Run an FA action that answers with a draft: the user's click in our UI is the confirmation,
 * the same as pressing the button in FA itself. needs_input is surfaced as an error to show the user.
 */
export async function faAct(name, args, humanReply = 'да') {
  const draft = await faTool(name, args);
  if (draft?.needs_input || draft?.status === 'needs_input') {
    const qs = (draft.questions || draft.needs_input || []);
    const list = Array.isArray(qs) ? qs.map(q => q.question || q.header || q).join('; ') : String(qs);
    throw new FaError(`FA просит уточнить: ${list}`, draft);
  }
  const draftId = draft?.draft_id;
  if (!draftId) return draft; // action executed without a draft (e.g. rename)
  return faTool('confirm', { draft_id: draftId, human_reply: humanReply });
}

const idsIn = (obj, prefix) => [...new Set(JSON.stringify(obj ?? '').match(new RegExp(`${prefix}_[A-Za-z0-9]{8,}`, 'g')) || [])];

/* ───── Products (engine) ───── */

/** Starts paid scrapes in FA; returns FA product ids in the order FA reports them. */
export async function faScrapeProducts(urls) {
  const res = await faAct('scrape_product', {
    urls,
    folder: 'none',
    bundle_preset_id: 'none',
    creative_preset_id: 'none',
  }, 'Соскрапить');
  const ids = idsIn(res, 'prd');
  if (!ids.length) throw new FaError(`FA не вернул id товаров: ${JSON.stringify(res).slice(0, 200)}`, res);
  return { ids, raw: res };
}

export const faGetProduct = (productId) => faTool('get_product', { product_id: productId });

/* ───── Creatives ───── */

export async function faStartGeneration({ product_id, language = 'fr', n = 1, aspect_ratio = '1:1', prompt, logo_key, landing_template_id, diversify }) {
  const res = await faAct('generate_creatives', {
    product_id,
    creative_preset_id: 'none',
    language,
    n,
    aspect_ratio,
    diversify: diversify ?? n > 1,
    product_photo: true,
    prompt: prompt || 'none',
    logo_key: logo_key || 'none',
    landing_template_id: landing_template_id || 'none',
  }, 'Сгенерировать');
  const ids = idsIn(res, 'gen');
  if (!ids.length) throw new FaError(`FA не вернул id генераций: ${JSON.stringify(res).slice(0, 200)}`, res);
  return ids;
}

export const faGetCreative = (generationId) => faTool('get_creative', { generation_id: generationId });

export async function faPollGeneration(generationId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const gen = await faGetCreative(generationId).catch(() => null);
    if (!gen) continue;
    if (gen.status === 'ready' || gen.status === 'done') return gen;
    if (gen.status === 'error' || gen.status === 'failed' || gen.error) {
      throw new FaError(`FA: генерация не удалась — ${gen.error || gen.status}`);
    }
  }
  throw new FaError('FA: генерация не закончилась за 3 минуты');
}

/** FA images live under /api/* behind Cloudflare Access; downloading needs a CF service token. */
export async function faDownloadImage(imagePath) {
  if (!faImagesAvailable()) {
    throw new FaError('Картинки FA закрыты Cloudflare Access — нужен сервисный токен (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET)');
  }
  const url = imagePath.startsWith('http') ? imagePath : `${FA_APP_URL}${imagePath}`;
  const res = await fetch(url, {
    headers: { 'CF-Access-Client-Id': CF_ID, 'CF-Access-Client-Secret': CF_SECRET, Authorization: `Bearer ${FA_TOKEN}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new FaError(`FA: не удалось скачать картинку (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export const faCreativeSpend = () => faTool('creative_spend');
export const faCreativeOptions = () => faTool('creative_options');

/* ───── Analytics & lists ───── */

export const faLandingFunnel = (_ws, from, to, group = 'template') =>
  faTool('landing_funnel', { day_from: from, day_to: to, group });
export const faLandingBehavior = (_ws, from, to) =>
  faTool('landing_behavior', { day_from: from, day_to: to });
export const faAnalyticsQuery = (plan, compare_range) =>
  faTool('analytics_query', { plan, ...(compare_range ? { compare_range } : {}) });
export const faListProductSearches = () => faTool('list_product_searches');
export const faListLandingTemplates = () => faTool('list_landing_templates');

/* ───── Campaigns (FA ids: fbkc_… rows, numeric Facebook ids) ───── */

export const faCampaignHistory = (campaignId) => faTool('campaign_history', { campaign_id: String(campaignId) });
export const faGetCampaignAds = (campaignId, period) =>
  faTool('get_campaign_ads', { campaign_id: String(campaignId), ...(period ? { period } : {}) });

export const faApplyAdSettings = (adsetId, presetId) =>
  faAct('apply_ad_settings', { adset_id: String(adsetId), preset_id: presetId });

export const faSetTargeting = (campaignId, { adset_id, age_min, age_max, gender, countries }) =>
  faAct('set_targeting', {
    campaign_id: String(campaignId),
    adset_id: String(adset_id),
    age_min: Number(age_min),
    age_max: Number(age_max),
    gender: gender || 'all',
    countries: Array.isArray(countries) ? countries.join(',') : String(countries || ''),
  });

export const faBulkEdit = (ids, action, value) =>
  faAct('bulk_edit', { ids: ids.map(String), action, ...(value !== undefined ? { value: String(value) } : {}) });

export const faDuplicate = (campaignId, { rowId, level = 'adset', copies = 1 }) =>
  faAct('duplicate', { campaign_id: String(campaignId), row_id: String(rowId), level, copies: Number(copies) });

export const faRename = (level, rowId, name) =>
  faTool('rename', { level, row_id: String(rowId), name });

export const faSetBudget = (campaignId, { rowId, level = 'campaign', dailyBudget }) =>
  faAct('set_budget', {
    campaign_id: String(campaignId),
    row_id: String(rowId || campaignId),
    level,
    daily_budget: String(dailyBudget),
  });

/* ───── Push ───── */

export const faPreparePush = (params) => faTool('prepare_push', params);
export const faPushTrace = (jobId) => faTool('push_trace', { job_id: jobId });

export const faFindSimilarProducts = (params) => faAct('find_similar_products', params, 'Искать');

export const faCheckProfile = (args) => faAct('check_profile', args);
