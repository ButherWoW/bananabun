// PIN doors of the stub page (platform/frontend/stub/index.html). The PIN is checked here, never in the page:
// a right PIN sets a signed pass cookie for its door, and nginx (platform/deploy/nginx-banana.conf and Umbrella's
// deploy/nginx-umbrella.conf) asks /gate/check/<door> before serving any page behind that door. No pass — 404.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIPv6 } from 'node:net';

const DAY = 24 * 60 * 60;
export const DOORS = {
  bl: { to: '/banana/login', ttl: 30 * DAY },
  bd: { to: '/banana/demo/', ttl: DAY / 2 },
  ul: { to: '/umbrella/login', ttl: 30 * DAY },
  ud: { to: '/umbrella/demo', ttl: DAY / 2 },
};
export const PIN_RE = /^\d{4,8}$/;

// GATE_PINS="2000:bd,1488:ud,…" (a GitHub secret written into backend .env by the deploy). Unknown doors are dropped.
export function parsePins(value) {
  const pins = new Map();
  for (const pair of String(value || '').split(',')) {
    const [pin, door] = pair.split(':').map((s) => s?.trim());
    if (PIN_RE.test(pin || '') && Object.hasOwn(DOORS, door || '')) pins.set(pin, door);
  }
  return pins;
}

const sign = (secret, door, exp) => createHmac('sha256', secret).update(`${door}.${exp}`).digest('base64url');

export function makePass(secret, door, now = Date.now()) {
  const exp = Math.floor(now / 1000) + DOORS[door].ttl;
  return { name: `gate_${door}`, value: `${exp}.${sign(secret, door, exp)}`, maxAge: DOORS[door].ttl };
}

export function passCookie(secret, door, now) {
  const p = makePass(secret, door, now);
  return `${p.name}=${p.value}; Max-Age=${p.maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function hasPass(secret, door, cookieHeader, now = Date.now()) {
  if (!Object.hasOwn(DOORS, door)) return false;
  const prefix = `gate_${door}=`;
  const raw = String(cookieHeader || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
  const m = /^(\d{1,12})\.([\w-]{43})$/.exec(raw?.slice(prefix.length) || '');
  if (!m || Number(m[1]) * 1000 <= now) return false;
  const want = Buffer.from(sign(secret, door, m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

// IPv6 addresses of one subscriber differ only in the lower 64 bits: count them as one client.
export function clientKey(ip) {
  const v = String(ip || '').trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return mapped[1];
  if (!isIPv6(v)) return v;
  const [head, tail] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : (tail ? tail.split(':') : []);
  const all = tail === undefined ? h : [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  return all.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// Wrong PINs: 5 from one client (IPv4 address or IPv6 /64) within 15 minutes lock that client for an hour; every
// repeated lock doubles the time (up to 24 h). A global tripwire (600 wrong PINs from everyone within an hour,
// i.e. a spread-out guess) closes the door for all until the hour is over. It used to be 60, which let one script
// at one request a minute lock the whole team out: the per-client limit, not the global one, is the guard now.
// A right PIN is never counted.
export function createLimiter({ perIp = 5, ipWindow = 15 * 60e3, ipLock = 60 * 60e3, maxLock = 24 * 60 * 60e3, total = 600, totalWindow = 60 * 60e3 } = {}) {
  const ips = new Map();
  let fails = [];
  return {
    blocked(ip, now = Date.now()) {
      fails = fails.filter((t) => now - t < totalWindow);
      if (fails.length >= total) return true;
      const e = ips.get(clientKey(ip));
      return Boolean(e && e.lockedUntil > now);
    },
    fail(ip, now = Date.now()) {
      fails.push(now);
      if (ips.size > 10000) for (const [k, v] of ips) if (v.lockedUntil + maxLock <= now && !v.times.some((t) => now - t < ipWindow)) ips.delete(k);
      const key = clientKey(ip);
      const e = ips.get(key) || { times: [], lockedUntil: 0, strikes: 0 };
      e.times = e.times.filter((t) => now - t < ipWindow).concat(now);
      if (e.times.length >= perIp) {
        e.lockedUntil = now + Math.min(ipLock * 2 ** e.strikes, maxLock);
        e.strikes += 1;
        e.times = [];
      }
      ips.set(key, e);
    },
  };
}
