import path from 'node:path';
import { api } from './adspower.js';
import { Graph, connect, isOk } from './cdp.js';
import { FB_DIR, sleep, writeSecret } from './common.js';

const AM_URL = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
const STATUS = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending_review', 9: 'grace_period', 100: 'pending_closure', 101: 'closed' };
const STATUS_LABEL = { active: 'Активен', disabled: 'Отключён', unsettled: 'Долг', pending_review: 'На проверке', grace_period: 'Льготный период', pending_closure: 'Закрывается', closed: 'Закрыт' };
const PAY = { 1: 'card', 4: 'prepaid' };

// Opens the profile (if closed), finds or opens an Ads Manager tab and takes the token
// from its session. Graph calls then run inside that tab, so they leave through the profile.
// The token is kept only in fb/fb_token_<serial>.txt (600) for fb_push.js.
// With { open: false } nothing is started or opened: returns null unless the profile already
// has an Ads Manager tab (used by the background refresh).
export async function openFbSession(userId, { open = true } = {}) {
  let info = await api('GET', `/api/v1/browser/active?user_id=${userId}`);
  if (info.status !== 'Active') {
    if (!open) return null;
    info = await api('GET', `/api/v1/browser/start?user_id=${userId}&open_tabs=1`);
  }
  const port = info.debug_port;
  if (!port) throw new Error('AdsPower не отдал порт отладки профиля');

  const list = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();
  let tab = (await list()).find((t) => t.type === 'page' && t.url.startsWith('https://adsmanager.facebook.com/'));
  if (!tab) {
    if (!open) return null;
    tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${AM_URL}`, { method: 'PUT' })).json();
  }

  const cdp = await connect(tab.webSocketDebuggerUrl);
  let token = '';
  for (let i = 0; i < 60 && !token; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const t = window.__accessToken; return typeof t === 'string' && t.startsWith('EAA') ? t : '' })()`,
      returnByValue: true,
    }).catch(() => null);
    token = r?.result?.value || '';
    if (!token) await sleep(1000);
  }
  if (!token) {
    // Where the tab ended up (login, checkpoint…): host, path and title only, never the query or cookies.
    const [locR, pathR] = await Promise.all([
      cdp.send('Runtime.evaluate', {
        expression: `(location.host + location.pathname).slice(0, 120) + ' «' + document.title.slice(0, 80) + '»'`,
        returnByValue: true,
      }).catch(() => null),
      cdp.send('Runtime.evaluate', { expression: `location.pathname`, returnByValue: true }).catch(() => null),
    ]);
    cdp.close();
    const tabInfo = locR?.result?.value || 'не прочитать';
    const pathname = pathR?.result?.value || '';
    const code = /\/(login|loginpage)/i.test(pathname) ? 'fb_logged_out'
      : /\/checkpoint/i.test(pathname) ? 'fb_checkpoint'
      : 'fb_timeout';
    throw Object.assign(
      new Error(`В профиле не открылся Ads Manager: проверьте, что Facebook залогинен (вкладка: ${tabInfo})`),
      { data: { code } }
    );
  }
  cdp.close();

  const profile = await api('GET', `/api/v1/user/list?user_id=${userId}&page=1&page_size=1`);
  const serial = profile.list?.[0]?.serial_number || userId;
  writeSecret(path.join(FB_DIR, `fb_token_${serial}.txt`), token);
  writeSecret(path.join(FB_DIR, `ws_${serial}.txt`), tab.webSocketDebuggerUrl);
  return { graph: await new Graph({ wsUrl: tab.webSocketDebuggerUrl, token }).open(), serial };
}

async function must(label, r) {
  if (r.fatal) throw new Error('Токен FB мёртв (код 190): перелогиньтесь в профиле');
  if (!isOk(r)) throw new Error(`${label}: ${r.data?.error?.message || `HTTP ${r.status}`}`);
  await sleep(250);
  return r.data;
}

// Read-only: token owner, ad accounts grouped by business, pages, pixels. No secrets in the result.
export async function readFbAssets(g) {
  const me = await must('me', await g.get('me', { fields: 'id,name' }));
  const acc = await must('adaccounts', await g.get('me/adaccounts', {
    fields: 'id,name,account_status,disable_reason,currency,funding_source_details,business{id,name}',
    limit: '200',
  }));
  let pagesRes = await g.get('me/accounts', { fields: 'id,name,business{id,name}', limit: '200' });
  if (!isOk(pagesRes)) pagesRes = await g.get('me/accounts', { fields: 'id,name', limit: '200' });
  const pages = await must('pages', pagesRes);

  const bms = new Map();
  const bmOf = (b) => {
    const key = b?.id || 'personal';
    if (!bms.has(key)) bms.set(key, { external_id: key, name: b?.name || 'Личные', cabinets: [], pages: [] });
    return bms.get(key);
  };

  for (const a of acc.data || []) {
    const status = STATUS[a.account_status] || String(a.account_status);
    let pixel = null;
    if (status === 'active') {
      const px = await g.get(`${a.id}/adspixels`, { fields: 'id', limit: '5' });
      pixel = px.data?.data?.[0]?.id || null;
      await sleep(250);
    }
    const payment = PAY[a.funding_source_details?.type] || (a.funding_source_details ? 'other' : 'none');
    bmOf(a.business).cabinets.push({
      external_id: a.id,
      name: a.name,
      status,
      status_label: STATUS_LABEL[status] || status,
      currency: a.currency,
      pixel,
      payment_missing: payment === 'none',
      ready: status === 'active' && payment !== 'none'
        ? { kind: 'ready', label: 'Готов к заливу' }
        : { kind: 'blocked', label: status !== 'active' ? STATUS_LABEL[status] || status : 'Нет оплаты' },
    });
  }
  for (const p of pages.data || []) bmOf(p.business).pages.push({ external_id: p.id, name: p.name });

  return { user: { id: me.id, name: me.name }, bms: [...bms.values()] };
}

const LIVE = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];

async function getAll(g, pathname, params) {
  const out = [];
  let after;
  for (let page = 0; page < 20; page++) {
    const r = await g.get(pathname, { ...params, limit: '200', ...(after ? { after } : {}) });
    if (r.fatal) throw Object.assign(new Error('Токен FB мёртв (код 190): перелогиньтесь в профиле'), { fatal: true });
    if (!isOk(r)) throw new Error(r.data?.error?.message || `HTTP ${r.status}`);
    out.push(...(r.data?.data || []));
    after = r.data?.paging?.next ? r.data.paging.cursors?.after : null;
    await sleep(250);
    if (!after) break;
  }
  return out;
}

const spend = (x) => (x?.data?.[0]?.spend != null ? Number(x.data[0].spend) : 0);

// Read-only: live campaigns and adsets of every ad account the token sees, with spend
// (today / yesterday / 7 days, in account currency). Budgets and bids stay in cents.
// opts.act — read only this ad account (the «Обновить» of one campaign); the server prunes only read_acts.
export async function readFbCampaigns(g, opts = {}) {
  const all = await getAll(g, 'me/adaccounts', { fields: 'id,name,currency,account_status,adtrust_dsl' });
  const only = opts.act ? `act_${String(opts.act).replace(/^act_/, '')}` : null;
  const accounts = only ? all.filter(a => a.id === only) : all;
  if (only && !accounts.length) throw new Error(`Кабинет ${only} не найден в профиле`);
  const campaigns = [];
  const errors = [];
  const readActs = [];
  for (const a of accounts) {
    try {
      const camps = await getAll(g, `${a.id}/campaigns`, {
        fields: 'id,name,status,effective_status,daily_budget,spend_cap,created_time,'
          + 'insights.date_preset(today).as(t){spend},insights.date_preset(yesterday).as(y){spend},insights.date_preset(last_7d).as(w){spend}',
        effective_status: LIVE,
      });
      if (!camps.length) { readActs.push(a.id); continue; }
      // 3 and 30 days come from the account's insights by campaign: more nested insights in the
      // campaign request made Facebook silently drop some of them. A failed read stays unknown, not zero.
      const spendBy = async (preset) => {
        try {
          const rows = await getAll(g, `${a.id}/insights`, { level: 'campaign', date_preset: preset, fields: 'campaign_id,spend' });
          return new Map(rows.map((r) => [String(r.campaign_id), Number(r.spend) || 0]));
        } catch (e) { if (e.fatal) throw e; return null; }
      };
      const s3 = await spendBy('last_3d');
      const s30 = await spendBy('last_30d');
      const periodSpend = (m, id) => (m ? (m.get(String(id)) ?? 0) : undefined);
      const adsets = await getAll(g, `${a.id}/adsets`, {
        fields: 'id,name,campaign_id,status,effective_status,daily_budget,bid_amount,targeting{age_min,age_max,genders,geo_locations}',
        effective_status: [...LIVE, 'CAMPAIGN_PAUSED'],
      });
      // Ads with moderation: why Facebook rejected an ad or why it has issues (raw; the server labels it).
      const ads = await getAll(g, `${a.id}/ads`, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,ad_review_feedback,issues_info',
        effective_status: [...LIVE, 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO'],
      });
      const adsOf = (adsetId) => ads.filter((x) => x.adset_id === adsetId).map((x) => ({
        id: x.id, name: x.name, status: x.status, effective_status: x.effective_status,
        review: x.ad_review_feedback?.global
          ? Object.fromEntries(Object.entries(x.ad_review_feedback.global).slice(0, 5).map(([k, v]) => [k, String(v).slice(0, 400)]))
          : null,
        issues: (x.issues_info || []).slice(0, 3).map((i) => ({
          code: i.error_code, summary: String(i.error_summary || '').slice(0, 200), message: String(i.error_message || '').slice(0, 300),
        })),
      }));
      for (const c of camps) {
        campaigns.push({
          id: c.id, act: a.id, act_name: a.name, currency: a.currency, account_status: a.account_status,
          name: c.name, status: c.status, effective_status: c.effective_status,
          daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null,
          spend_cap: Number(c.spend_cap) > 0 && String(c.spend_cap) !== NO_SPEND_CAP ? Number(c.spend_cap) : null,
          created_time: c.created_time,
          spend_today: spend(c.t), spend_yesterday: spend(c.y), spend_7d: spend(c.w),
          spend_3d: periodSpend(s3, c.id), spend_30d: periodSpend(s30, c.id),
          adsets: adsets.filter((s) => s.campaign_id === c.id).map((s) => ({
            id: s.id, name: s.name, status: s.status, effective_status: s.effective_status,
            daily_budget: s.daily_budget != null ? Number(s.daily_budget) : null,
            bid_amount: s.bid_amount != null ? Number(s.bid_amount) : null,
            audience: s.targeting ? {
              age_min: s.targeting.age_min ?? null, age_max: s.targeting.age_max ?? null,
              genders: s.targeting.genders?.length === 1 ? (s.targeting.genders[0] === 1 ? 'male' : 'female') : 'all',
              countries: s.targeting.geo_locations?.countries || [],
            } : null,
            ads: adsOf(s.id),
          })),
        });
      }
      readActs.push(a.id);
    } catch (e) {
      if (e.fatal) throw e; // code 190: stop, never keep calling Graph with a dead token
      errors.push(`${a.id}: ${e.message}`);
    }
  }
  // read_acts: accounts read without error — only their campaigns may be pruned server-side.
  // Daily spend limit per cabinet (adtrust_dsl, -1 = none) for the «where to push» hint.
  const accountsInfo = accounts.map((a) => ({
    id: a.id, currency: a.currency, account_status: a.account_status,
    daily_limit: Number(a.adtrust_dsl) > 0 ? Number(a.adtrust_dsl) : null,
  }));
  return { campaigns, errors, accounts: accounts.length, read_acts: readActs, accounts_info: accountsInfo };
}

// Whitelisted edits only: status PAUSED/ACTIVE, daily_budget / bid_amount (cents), name.
const NO_SPEND_CAP = '922337203685478'; // Graph's value for «no spend cap»

// Patch of a live adset's targeting: only age, gender and countries change, the rest is kept as is.
async function patchTargeting(g, id, patch) {
  const r = await g.get(id, { fields: 'targeting' });
  if (r.fatal) throw Object.assign(new Error('Токен FB мёртв (код 190): перелогиньтесь в профиле'), { fatal: true });
  if (!isOk(r)) throw new Error(`${id}: ${r.data?.error?.message || `HTTP ${r.status}`}`);
  const t = { ...(r.data.targeting || {}) };
  if (patch.age_min != null) t.age_min = patch.age_min;
  if (patch.age_max != null) t.age_max = patch.age_max;
  if (patch.genders) { if (patch.genders === 'all') delete t.genders; else t.genders = [patch.genders === 'male' ? 1 : 2]; }
  if (patch.countries?.length) t.geo_locations = { countries: patch.countries };
  return t;
}

// Copies are always PAUSED. An adset is copied without its ads, then each ad is copied into it:
// Graph refuses a deep copy of an adset with more than 3 ads.
async function copyObject(g, op, done) {
  const must = (label, r) => {
    if (r.fatal) throw Object.assign(new Error('Токен FB мёртв (код 190): перелогиньтесь в профиле'), { data: { done } });
    if (!isOk(r)) {
      const e = r.data?.error || {};
      throw Object.assign(new Error(`${label}: ${e.error_user_msg || e.message || `HTTP ${r.status}`}`), { data: { done } });
    }
    return r.data;
  };
  const copies = Math.min(Math.max(Number(op.copy.copies) || 1, 1), 10);
  for (let n = 0; n < copies; n++) {
    if (op.copy.level === 'ad') {
      const d = must(`copy ad ${op.id}`, await g.post(`${op.id}/copies`, { status_option: 'PAUSED' }));
      done.push({ id: op.id, copied: d.copied_ad_id || d.ad_object_ids?.[0]?.copied_id || null, level: 'ad' });
    } else {
      const d = must(`copy adset ${op.id}`, await g.post(`${op.id}/copies`, { status_option: 'PAUSED', deep_copy: false }));
      const newId = d.copied_adset_id || d.ad_object_ids?.[0]?.copied_id;
      if (!newId) throw Object.assign(new Error(`copy adset ${op.id}: Facebook не вернул id копии`), { data: { done } });
      // The copy exists from here on: record it before its ads, so a failure halfway still reports it.
      const entry = { id: op.id, copied: newId, level: 'adset', ads: 0, ads_total: null };
      done.push(entry);
      const ads = must(`ads of ${op.id}`, await g.get(`${op.id}/ads`, { fields: 'id', limit: '100' })).data || [];
      entry.ads_total = ads.length;
      for (const ad of ads) {
        must(`copy ad ${ad.id} (копия адсета ${newId} создана, объявлений скопировано ${entry.ads} из ${ads.length})`,
          await g.post(`${ad.id}/copies`, { adset_id: newId, status_option: 'PAUSED' }));
        entry.ads++;
        await sleep(350);
      }
    }
    await sleep(350);
  }
}

export async function editFbObjects(g, ops) {
  const done = [];
  for (const op of ops) {
    if (!/^\d+$/.test(String(op.id))) throw new Error(`bad object id ${op.id}`);
    if (op.copy) {
      if (!['adset', 'ad'].includes(op.copy.level)) throw new Error('bad copy level');
      await copyObject(g, op, done);
      continue;
    }
    const fields = {};
    if (op.targeting) {
      fields.targeting = await patchTargeting(g, String(op.id), op.targeting)
        .catch((e) => { throw Object.assign(e, { data: { done } }); });
    }
    if (op.spend_cap != null) {
      if (op.spend_cap === 'clear') fields.spend_cap = NO_SPEND_CAP;
      else if (!Number.isInteger(op.spend_cap) || op.spend_cap <= 0) throw new Error('bad spend_cap');
      else fields.spend_cap = String(op.spend_cap);
    }
    if (op.status) {
      if (!['PAUSED', 'ACTIVE'].includes(op.status)) throw new Error(`bad status ${op.status}`);
      fields.status = op.status;
    }
    for (const k of ['daily_budget', 'bid_amount']) {
      if (op[k] != null) {
        if (!Number.isInteger(op[k]) || op[k] <= 0) throw new Error(`bad ${k}`);
        fields[k] = String(op[k]);
      }
    }
    if (op.name) fields.name = String(op.name).slice(0, 400);
    if (!Object.keys(fields).length) continue;
    const r = await g.post(String(op.id), fields);
    if (r.fatal) throw Object.assign(new Error('Токен FB мёртв (код 190): перелогиньтесь в профиле'), { data: { done } });
    if (!isOk(r)) {
      const e = r.data?.error || {};
      throw Object.assign(new Error(`${op.id}: ${e.error_user_msg || e.message || `HTTP ${r.status}`}`), { data: { done } });
    }
    const { targeting, ...plain } = fields;
    done.push({ id: op.id, ...plain, ...(targeting ? { targeting: op.targeting } : {}) });
    await sleep(350);
  }
  return { done };
}
