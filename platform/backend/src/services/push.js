import { db } from '../db/client.js';
import { keitaroClient } from './keitaro.js';
import { enqueueAgentJob } from '../api/routes/agent.js';
import { logFbEvent } from './fb-campaigns.js';
import { emit } from './telegram.js';

// Absolute links go under the panel's base (https://nespizdili.lol/banana); old /uploads and /api keep working.
const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || 'https://nespizdili.lol').replace(/\/$/, '');

// Keitaro campaign parameters: FB fills the macros, and campaign_id lands in sub_id_2 —
// the only key the FB↔Keitaro join uses.
const KT_PARAMETERS = {
  external_id: { name: 'fbclid', placeholder: '' },
  ad_campaign_id: { name: 'utm_campaign', placeholder: '{{campaign.name}}' },
  source: { name: 'utm_source', placeholder: '{{site_source_name}}' },
  sub_id_1: { name: 'utm_placement', placeholder: '{{placement}}' },
  sub_id_2: { name: 'campaign_id', placeholder: '{{campaign.id}}' },
  sub_id_3: { name: 'adset_id', placeholder: '{{adset.id}}' },
  sub_id_4: { name: 'ad_id', placeholder: '{{ad.id}}' },
  sub_id_5: { name: 'adset_name', placeholder: '{{adset.name}}' },
  sub_id_7: { name: 'ad_name', placeholder: '{{ad.name}}' },
};
const URL_TAGS = Object.values(KT_PARAMETERS).filter(p => p.placeholder).map(p => `${p.name}=${p.placeholder}`).join('&');

async function log(pushId, step, data = {}) {
  console.log(`[push:${pushId}] ${step}`, data);
  await db.query(
    `UPDATE pushes SET log = log || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify([{ ts: new Date().toISOString(), step, ...data }]), pushId]
  );
}

async function fail(pushId, error) {
  await db.query(`UPDATE pushes SET status='failed', error=$1, finished_at=NOW() WHERE id=$2`, [error, pushId]);
  await pushEvent(pushId, false, error);
}

// Telegram: the push's author (and owner/lead for failures) hears how it ended. One message per attempt end.
async function pushEvent(pushId, ok, error, ads) {
  const { rows: [p] } = await db.query(`
    SELECT p.workspace_id, p.created_by, p.params, p.finished_at, pr.title FROM pushes p LEFT JOIN products pr ON pr.id = p.product_id
     WHERE p.id = $1`, [pushId]);
  if (!p) return;
  emit(ok ? 'push_done' : 'push_failed', {
    workspace_id: p.workspace_id, owner_user_id: p.created_by,
    dedupe_key: `push:${pushId}:${ok ? 'done' : 'failed'}:${new Date(p.finished_at || Date.now()).getTime()}`,
    payload: { title: p.title || p.params?.campaign_name, cabinet: p.params?.cabinet_external_id, error, ads },
  });
}

function translit(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Alias from the product name (letters/digits only) + "-promo"; unique across the tracker.
// Aliases are never changed after creation.
function makeAlias(productName) {
  const words = translit(productName).split(/[^a-z0-9]+/).filter(w => w.length > 1).slice(0, 3);
  const base = (words.map((w, i) => (i === 0 ? w.slice(0, 5) : w.slice(0, 3))).join('') || 'offer').slice(0, 12);
  return `${base}-${Math.random().toString(36).slice(2, 6)}-promo`;
}

function shares(ids) {
  const base = Math.floor(100 / ids.length);
  return ids.map((id, i) => ({ offer_id: Number(id), share: i === 0 ? 100 - base * (ids.length - 1) : base, state: 'active' }));
}

// Campaign + regular stream (landing + offers, no country filter) + default stream (white).
// Rerun-safe: reuses the campaign saved on the push and adds only missing streams.
async function ensureKeitaro(kt, push, params, productName) {
  // Only a real 404 means the campaign is gone; a timeout or 5xx must not create a duplicate.
  let campaign = null;
  if (push.kt_campaign_id) {
    campaign = await kt.campaign(push.kt_campaign_id).catch((e) => {
      if (/^Keitaro 404/.test(e.message)) return null;
      throw e;
    });
  }
  if (!campaign) {
    const alias = makeAlias(productName);
    campaign = await kt.createCampaign({
      name: params.campaign_name,
      alias,
      type: 'position',
      state: 'active',
      domain_id: Number(params.domain_id),
      ...(params.kt_group_id ? { group_id: Number(params.kt_group_id) } : {}),
      cost_type: 'CPC',
      cost_auto: true,
      uniqueness_method: 'ip_ua',
      parameters: KT_PARAMETERS,
    });
    await db.query(`UPDATE pushes SET kt_campaign_id=$1 WHERE id=$2`, [String(campaign.id), push.id]);
    await log(push.id, 'keitaro_campaign_created', { id: campaign.id, alias: campaign.alias });
  }

  const streams = await kt.campaignStreams(campaign.id);
  const offers = shares(params.offer_ids);
  if (!streams.some(s => s.type === 'regular')) {
    await kt.createStream({
      campaign_id: campaign.id, type: 'regular', name: 'Flow 1', position: 1, weight: 100,
      schema: 'landings', action_type: 'http', state: 'active', collect_clicks: true,
      filter_or: false, offer_selection: 'after_click', filters: [],
      landings: [{ landing_id: Number(params.kt_landing_id), share: 100, state: 'active' }],
      offers,
    });
  }
  if (!streams.some(s => s.type === 'default')) {
    await kt.createStream({
      campaign_id: campaign.id, type: 'default', name: 'White', position: 2, weight: 0,
      schema: 'landings', action_type: 'http', state: 'active', collect_clicks: false,
      filter_or: false, offer_selection: 'before_click', filters: [],
      landings: [{ landing_id: Number(params.white_landing_id), share: 100, state: 'active' }],
      offers: [],
    });
  }
  return campaign;
}

// Adset targeting from the preset: geo, age, gender, devices, placements. Advantage+ audience stays off.
export function buildTargeting(params) {
  const t = {
    geo_locations: { countries: params.countries },
    age_min: Number(params.age_min) || 18,
    age_max: Number(params.age_max) || 65,
    targeting_automation: { advantage_audience: 0 },
  };
  if (params.genders === 'male') t.genders = [1];
  if (params.genders === 'female') t.genders = [2];
  if (params.devices === 'mobile' || params.devices === 'desktop') t.device_platforms = [params.devices];
  if (params.auto_placement === false && params.platforms?.length) t.publisher_platforms = params.platforms;
  return t;
}

// Which creatives go into which adset (indexes into the creative list).
// all-all: every creative in every adset. one-per: each adset gets its own N creatives, no repeats.
export function creativeLayout(params, adsets, total) {
  if (params.creo_mode !== 'one-per') return Array.from({ length: adsets }, () => [...Array(total).keys()]);
  const n = Math.max(Number(params.creo_per_adset) || 1, 1);
  if (n * adsets > total) throw new Error(`Раскладка «по ${n} на адсет» требует ${n * adsets} креативов, а их ${total}`);
  return Array.from({ length: adsets }, (_, a) => Array.from({ length: n }, (_, j) => a * n + j));
}

// Server side of a push: checks inputs, prepares Keitaro, then hands FB work to the Mac agent.
// FB objects are created only through the AdsPower profile, always PAUSED; the agent's
// result is written back in agent.js (type 'push').
export async function runPush(pushId) {
  try {
    const push = await db.findOne('pushes', { id: pushId });
    if (!push) throw new Error('Push not found');
    const params = push.params || {};
    const ws = await db.findOne('workspaces', { id: push.workspace_id });

    const missing = [];
    if (!(Number(params.daily_budget) > 0)) missing.push('дневной бюджет');
    if (!(Number(params.bid_amount) > 0)) missing.push('ставка');
    if (!params.cabinet_external_id) missing.push('кабинет');
    if (!params.page_external_id) missing.push('страница');
    if (!params.pixel_id) missing.push('пиксель');
    if (!params.creative_ids?.length) missing.push('креативы');
    if (!params.countries?.length) missing.push('гео');
    if (!params.domain_id) missing.push('домен Keitaro');
    if (!params.kt_landing_id) missing.push('лендинг в Keitaro');
    if (!params.white_landing_id) missing.push('вайт');
    if (!params.offer_ids?.length) missing.push('оффер');
    if (missing.length) throw new Error(`Не хватает: ${missing.join(', ')}`);
    if (!ws?.keitaro_url || !ws?.keitaro_api_key) throw new Error('Keitaro не настроен');

    // Claim the push: a second concurrent run (double click, retry while running) stops here.
    const { rowCount: claimed } = await db.query(
      `UPDATE pushes SET status='running', started_at=NOW(), error=NULL WHERE id=$1 AND status='pending'`, [pushId]);
    if (!claimed) return;

    // Profile that owns the cabinet, and the page name for DSA.
    const { rows: [owner] } = await db.query(`
      SELECT ap.raw->>'user_id' AS user_id
        FROM fb_cabinets c JOIN fb_accounts fa ON fa.id = c.fb_account_id
        JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
       WHERE c.workspace_id = $1 AND c.external_id IN ($2, $3) LIMIT 1`,
      [push.workspace_id, String(params.cabinet_external_id), `act_${String(params.cabinet_external_id).replace(/^act_/, '')}`]);
    if (!owner?.user_id) throw new Error('Кабинет не привязан к профилю AdsPower — нажмите «Проверить» у аккаунта');
    const { rows: [page] } = await db.query(
      `SELECT name FROM fb_pages WHERE workspace_id=$1 AND external_id=$2 LIMIT 1`,
      [push.workspace_id, String(params.page_external_id)]);
    if (!page?.name) throw new Error('Страница не найдена в кабинетах аккаунта — обновите проверку аккаунта');

    const { rows: creatives } = await db.query(
      // In the buyer's order: the creative layout indexes positions of creative_ids.
      `SELECT id, file_url FROM creatives WHERE workspace_id=$1 AND id = ANY($2) AND status='done' AND file_url IS NOT NULL
        ORDER BY array_position($2::varchar[], id)`,
      [push.workspace_id, params.creative_ids]);
    if (creatives.length !== params.creative_ids.length) throw new Error('Часть креативов не готова или не найдена');

    const product = params.product_id ? await db.findOne('products', { id: params.product_id }) : null;

    // Keitaro is ours: called from the server.
    const kt = keitaroClient(ws.keitaro_url, ws.keitaro_api_key);
    const campaign = await ensureKeitaro(kt, push, params, product?.title || params.campaign_name);
    const domains = await kt.domains();
    const domain = (Array.isArray(domains) ? domains : []).find(d => Number(d.id) === Number(params.domain_id));
    if (!domain?.name) throw new Error('Домен Keitaro не найден');
    const link = `https://${String(domain.name).replace(/^https?:\/\//, '').replace(/\/$/, '')}/${campaign.alias}`;
    await log(pushId, 'keitaro_ready', { campaign_id: campaign.id, link });

    const adsets = Number(params.adsets_count) || 3;
    const spec = {
      act: String(params.cabinet_external_id),
      name: params.campaign_name,
      page_id: String(params.page_external_id),
      page_name: page.name,
      pixel_id: String(params.pixel_id),
      custom_event_type: params.pixel_event || 'LEAD',
      adsets,
      daily_budget: Math.round(Number(params.daily_budget) * 100),
      bid_amount: Math.round(Number(params.bid_amount) * 100),
      ...(params.bid_amounts?.length === adsets ? { bid_amounts: params.bid_amounts.map(b => Math.round(Number(b) * 100)) } : {}),
      targeting: buildTargeting(params),
      layout: creativeLayout(params, adsets, creatives.length),
      link,
      url_tags: URL_TAGS,
      cta: params.call_to_action || 'SHOP_NOW',
      creatives: creatives.map(c => ({
        url: c.file_url.startsWith('/') ? PUBLIC_URL + c.file_url : c.file_url,
        primary_text: params.ad_body || '',
        headline: params.ad_title || '',
      })),
    };

    const jobId = await enqueueAgentJob(push.workspace_id, 'push', { push_id: pushId, user_id: owner.user_id, spec }, push.created_by);
    await db.query(`UPDATE pushes SET agent_job_id = $1 WHERE id = $2`, [jobId, pushId]);
    await log(pushId, 'fb_queued', { job_id: jobId, ads: spec.layout.flat().length });
  } catch (err) {
    console.error(`[push:${pushId}] ERROR:`, err.message);
    await fail(pushId, err.message).catch(() => {});
  }
}

// Agent reported back on a push job.
// Only the push's current job may close it. A late result of that job after the reaper marked the push
// failed still records the FB ids (the objects exist), so nothing created in FB is lost.
export async function applyPushResult(ws, pushId, ok, error, data, jobId) {
  const { rowCount } = await db.query(`
    UPDATE pushes SET status=$1, error=$2, fb_campaign_id=COALESCE($3, fb_campaign_id),
           fb_adset_ids=COALESCE($4::jsonb, fb_adset_ids), fb_ad_ids=COALESCE($5::jsonb, fb_ad_ids),
           finished_at=NOW(), updated_at=NOW()
     WHERE id=$6 AND workspace_id=$7 AND (agent_job_id IS NULL OR agent_job_id = $8)
       AND (status = 'running' OR (status = 'failed' AND $1 = 'done'))`,
    [ok ? 'done' : 'failed', ok ? null : error, data?.campaign_id || null,
     data?.adset_ids ? JSON.stringify(data.adset_ids) : null, data?.ad_ids ? JSON.stringify(data.ad_ids) : null, pushId, ws, jobId ?? null]);
  if (!rowCount) return;
  await log(pushId, ok ? 'done' : 'fb_failed', { campaign_id: data?.campaign_id, ads: data?.ad_ids?.length || 0, ...(ok ? {} : { error }) });
  await pushEvent(pushId, ok, error, data?.ad_ids?.length || 0).catch(() => {});
  if (data?.campaign_id) {
    const { rows: [p] } = await db.query(`SELECT created_by FROM pushes WHERE id=$1 AND workspace_id=$2`, [pushId, ws]);
    await logFbEvent(ws, data.campaign_id, p?.created_by, ok
      ? `Залита платформой: ${data.adset_ids?.length || 0} адсетов, ${data.ad_ids?.length || 0} объявлений, всё на паузе`
      : `Залив оборвался: ${error || 'ошибка'}`).catch(() => {});
  }
}
