import path from 'node:path';
import { ROOT, readSecret, sleep } from './common.js';

const BASE = process.env.ADSPOWER_URL || 'http://127.0.0.1:50325';
const KEY_FILE = process.env.ADSPOWER_KEY_FILE || path.join(ROOT, '.adspower_key');

// AdsPower Local API allows ~1 request per second. Each call reserves its slot synchronously,
// so concurrent callers (main loop + 2FA lane) queue up instead of firing together.
let last = 0;
async function throttle() {
  const at = Math.max(Date.now(), last + 1100);
  last = at;
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

export async function api(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const key = readSecret(KEY_FILE, 'AdsPower key');
    const res = await fetch(BASE + route, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json();
    if (json.code === 0) return json.data;
    // Another process on this Mac can use the same limit: wait and retry a couple of times.
    if (/too many request/i.test(json.msg || '') && attempt < 3) { await sleep(1200 * (attempt + 1)); continue; }
    throw new Error(`AdsPower ${route}: ${json.msg}`);
  }
}

// Only non-sensitive fields: remarks hold passwords and tokens.
export function safeProfile(p) {
  return {
    serial_number: p.serial_number,
    user_id: p.user_id,
    name: p.name || '',
    group: p.group_name || '',
    country: p.ip_country || '',
    last_open: p.last_open_time ? new Date(Number(p.last_open_time) * 1000).toISOString().slice(0, 16) : '',
  };
}

export async function listProfiles() {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await api('GET', `/api/v1/user/list?page=${page}&page_size=100`);
    out.push(...data.list.map(safeProfile));
    if (data.list.length < 100) break;
  }
  return out;
}

export async function activeBrowser(serial) {
  return api('GET', `/api/v1/browser/active?serial_number=${encodeURIComponent(serial)}`);
}

export async function startBrowser(serial) {
  return api('GET', `/api/v1/browser/start?serial_number=${encodeURIComponent(serial)}&open_tabs=1`);
}
