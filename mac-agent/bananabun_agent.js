#!/usr/bin/env node
// Bridge between Bananabun (server) and AdsPower on this Mac.
// Pushes safe profile fields every 5 min and runs queued jobs (sync, open/close, FB check, push).
// Usage: bananabun_agent.js [--once]
import fs from 'node:fs';
import path from 'node:path';
import { api } from './lib/adspower.js';
import { editFbObjects, openFbSession, readFbAssets, readFbCampaigns } from './lib/fbprofile.js';
import { emptyState, runFbPush } from './lib/fbpush.js';
import { scrapeAmazon, searchAmazonPage } from './lib/amazon.js';
import { scrapeMarketplace } from './lib/marketplaces.js';
import { scrapeWalmart } from './lib/walmart.js';
import { findKey, totp } from './lib/totp.js';
import { ROOT, readSecret, sleep, redact, readJson, writeJson } from './lib/common.js';
import { assertAllowedUser, filterProfiles, isAllowedSerial, loadAllowed } from './lib/allowlist.js';

const SERVER = process.env.BANANABUN_URL || 'https://nespizdili.lol/banana';
const KEY = readSecret(process.env.BANANABUN_AGENT_KEY_FILE || path.join(ROOT, '.bananabun_agent_key'), 'Bananabun agent key');
const once = process.argv.includes('--once');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a.map((x) => redact(String(x))));

async function server(method, route, body) {
  const res = await fetch(SERVER + route, {
    method,
    headers: { 'X-Agent-Key': KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${json.error || ''}`);
  return json;
}

// Whitelist only: remarks/passwords/proxies stay on this Mac.
function safe(p) {
  const fb = (p.platform_account || []).find((a) => (a.domain_name || '').includes('facebook'));
  return {
    user_id: p.user_id,
    serial_number: p.serial_number,
    name: p.name || '',
    group_id: p.group_id || '',
    group_name: p.group_name || '',
    ip_country: p.ip_country || '',
    email: fb?.login_user || '',
  };
}

// Profiles outside the allow-list (if one is set) are never reported, opened or read.
const allowed = loadAllowed();
const serials = new Map();
async function serialOf(uid) {
  if (!serials.has(uid)) {
    const data = await api('GET', `/api/v1/user/list?user_id=${uid}&page_size=1`);
    const p = (data.list || []).find((x) => x.user_id === uid);
    if (p) serials.set(uid, String(p.serial_number));
  }
  return serials.get(uid);
}
const guardUser = (uid) => assertAllowedUser(allowed, uid, serialOf);

async function syncProfiles() {
  const profiles = [];
  for (let page = 1; ; page++) {
    const data = await api('GET', `/api/v1/user/list?page=${page}&page_size=100`);
    profiles.push(...data.list.map(safe));
    if (data.list.length < 100) break;
  }
  for (const p of profiles) serials.set(p.user_id, String(p.serial_number));
  const r = await server('POST', '/api/agent/ingest', { profiles: filterProfiles(allowed, profiles) });
  return { total: profiles.length, synced: r.synced };
}

// Creative images: https only, image types only, up to 30 MB; kept next to the push state.
async function downloadImage(url, dir, i) {
  if (!/^https:\/\//.test(url)) throw new Error(`creative ${i + 1}: only https image URLs`);
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`creative ${i + 1}: HTTP ${res.status} ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 30 * 1024 * 1024) throw new Error(`creative ${i + 1}: image over 30 MB`);
  const file = path.join(dir, `c${i}.${type.split('/')[1].replace('jpeg', 'jpg')}`);
  fs.writeFileSync(file, buf);
  return file;
}

// FB push through the profile. State lives in push/<push_id>/state.json, so a retry of the
// same push only adds what is missing. Everything is created PAUSED.
async function runPush(job) {
  const { push_id: pushId, user_id: uid, spec } = job.payload || {};
  if (!/^[A-Za-z0-9_-]+$/.test(String(pushId || ''))) throw new Error('bad push_id');
  if (!/^[a-z0-9]+$/i.test(String(uid || ''))) throw new Error('bad user_id');
  await guardUser(uid);
  const dir = path.join(ROOT, 'push', pushId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(dir, 'state.json');
  const state = fs.existsSync(stateFile) ? readJson(stateFile) : emptyState();
  const save = () => writeJson(stateFile, state);
  const summary = () => ({ campaign_id: state.campaign_id || null, adset_ids: state.adsets, ad_ids: Object.values(state.ads) });

  const creatives = [];
  for (const [i, c] of (spec?.creatives || []).entries()) {
    const have = fs.readdirSync(dir).find((f) => f.startsWith(`c${i}.`));
    creatives.push({ ...c, file: have ? path.join(dir, have) : await downloadImage(c.url, dir, i) });
  }

  const { graph } = await openFbSession(uid);
  try {
    await runFbPush(graph, { ...spec, creatives }, state, save, (m) => log(`push ${pushId}: ${m}`));
    return summary();
  } catch (e) {
    save();
    const d = summary();
    if (e.data?.code) d.code = e.data.code;
    throw Object.assign(e, { data: d });
  } finally { graph.close(); }
}

// Amazon jobs share the scrape profile and its language cookie: one at a time, whichever lane runs them.
let amazonQueue = Promise.resolve();
function amazonJob(fn) {
  const run = amazonQueue.then(fn, fn);
  amazonQueue = run.catch(() => {});
  return run;
}

async function runJob(job) {
  if (job.type === 'push') return runPush(job);
  if (job.type === 'scrape_amazon') return amazonJob(() => scrapeAmazon(String(job.payload?.url || '')));
  // Same scrape profile: Walmart pages queue behind Amazon ones.
  if (job.type === 'scrape_walmart') return amazonJob(() => scrapeWalmart(String(job.payload?.url || '')));
  if (['scrape_target', 'scrape_bestbuy', 'scrape_etsy'].includes(job.type)) return amazonJob(() => scrapeMarketplace(job.type.slice(7), String(job.payload?.url || '')));
  if (job.type === 'search_amazon') return amazonJob(() => searchAmazonPage(String(job.payload?.url || '')));
  if (job.type === 'sync') return syncProfiles();
  if (job.type === 'open') {
    const uid = String(job.payload?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(uid)) throw new Error('bad user_id');
    await guardUser(uid);
    const active = await api('GET', `/api/v1/browser/active?user_id=${uid}`);
    if (active.status === 'Active') return { already_open: true };
    await api('GET', `/api/v1/browser/start?user_id=${uid}&open_tabs=1`);
    return { opened: true };
  }
  if (job.type === 'check_profile') {
    const uid = String(job.payload?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(uid)) throw new Error('bad user_id');
    await guardUser(uid);
    const { graph } = await openFbSession(uid);
    try { return await readFbAssets(graph); } finally { graph.close(); }
  }
  if (job.type === 'fb_campaigns' || job.type === 'fb_edit') {
    const uid = String(job.payload?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(uid)) throw new Error('bad user_id');
    await guardUser(uid);
    const { graph } = await openFbSession(uid);
    try {
      return job.type === 'fb_campaigns'
        ? await readFbCampaigns(graph, { act: job.payload?.act })
        : await editFbObjects(graph, job.payload.ops || []);
    } finally { graph.close(); }
  }
  if (job.type === 'totp') {
    const uid = String(job.payload?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(uid)) throw new Error('bad user_id');
    await guardUser(uid);
    const data = await api('GET', `/api/v1/user/list?user_id=${uid}&page_size=1`);
    const p = (data.list || []).find(x => x.user_id === uid);
    if (!p) throw new Error('Профиль не найден в AdsPower');
    const k = findKey(p);
    if (!k) throw new Error('Ключ 2FA не найден: нет поля 2FA в AdsPower, а в заметке профиля нет ни «2FA: КЛЮЧ», ни ключа отдельным полем строки аккаунта (…|токен|id|КЛЮЧ)');
    const t = totp(k.key);
    // Only the code leaves this Mac — never the key.
    return { ...t, source: k.source, at: Date.now() };
  }
  if (job.type === 'close') {
    const uid = String(job.payload?.user_id || '');
    if (!/^[a-z0-9]+$/i.test(uid)) throw new Error('bad user_id');
    await guardUser(uid);
    await api('GET', `/api/v1/browser/stop?user_id=${uid}`);
    return { closed: true };
  }
  throw new Error(`unknown job type ${job.type}`);
}

// Reports a result, retrying so a finished job is not lost to one network hiccup.
async function report(id, body) {
  for (let i = 0; i < 5; i++) {
    try { return await server('POST', `/api/agent/jobs/${id}/result`, body); } catch (e) {
      if (/HTTP 404/.test(e.message)) return null;
      await sleep(3000 * (i + 1));
    }
  }
  log(`job ${id}: result not delivered`);
  return null;
}

// Jobs come one at a time; keep asking until the queue is empty.
async function tick() {
  for (;;) {
    const { jobs } = await server('GET', '/api/agent/jobs');
    if (!jobs.length) return;
    for (const job of jobs) {
      let body;
      try {
        body = { ok: true, data: await runJob(job) };
        log(`job ${job.id} ${job.type}: ok`);
      } catch (e) {
        body = { ok: false, error: redact(e.message), data: e.data };
        log(`job ${job.id} ${job.type}: ${e.message}`);
      }
      await report(job.id, body);
    }
  }
}

// Every 15 min: campaigns of profiles that already have Ads Manager open (nothing is started).
async function refreshOpenProfiles() {
  const active = await api('GET', '/api/v1/browser/local-active').catch(() => ({ list: [] }));
  for (const b of active.list || []) {
    if (allowed && !isAllowedSerial(allowed, await serialOf(b.user_id).catch(() => null))) continue;
    const session = await openFbSession(b.user_id, { open: false }).catch(() => null);
    if (!session) continue;
    try {
      const data = await readFbCampaigns(session.graph);
      await server('POST', '/api/agent/fb-campaigns', { user_id: b.user_id, ...data });
      log(`campaigns ${b.user_id}: ${data.campaigns.length}`);
    } catch (e) {
      log(`campaigns ${b.user_id}: ${e.message}`);
    } finally { session.graph.close(); }
  }
}

// Fast lane for short jobs (2FA codes, Amazon searches): they never wait behind a push or a campaign read.
async function fastLane() {
  for (;;) {
    try {
      const { jobs } = await server('GET', '/api/agent/jobs?type=fast');
      for (const job of jobs) {
        let body;
        try { body = { ok: true, data: await runJob(job) }; log(`job ${job.id} ${job.type}: ok`); }
        catch (e) { body = { ok: false, error: redact(e.message), data: e.data }; log(`job ${job.id} ${job.type}: ${e.message}`); }
        await report(job.id, body);
      }
      if (jobs.length) continue;
    } catch {}
    await sleep(2000);
  }
}

let lastSync = 0;
let lastCampaigns = 0;
log(`agent → ${SERVER}${allowed ? `, профили: ${[...allowed].join(', ')}` : ''}`);
if (!once) fastLane();
for (;;) {
  try {
    if (Date.now() - lastSync > 5 * 60 * 1000) {
      const r = await syncProfiles();
      lastSync = Date.now();
      log(`profiles ${r.synced}/${r.total}`);
    }
    if (Date.now() - lastCampaigns > 15 * 60 * 1000) {
      lastCampaigns = Date.now();
      await refreshOpenProfiles();
    }
    await tick();
  } catch (e) {
    log(`error: ${e.message}`);
  }
  if (once) break;
  await sleep(5000);
}
