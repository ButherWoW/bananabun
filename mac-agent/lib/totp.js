// 2FA codes (TOTP, RFC 6238: SHA-1, 6 digits, 30 s) computed on this Mac.
// The key never leaves the machine: only the current code goes to the server.
import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(secret) {
  const s = String(secret).toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]{16,128}$/.test(s)) return null;
  let bits = '';
  for (const c of s) bits += ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

export function totp(secret, now = Date.now(), period = 30) {
  const key = base32(secret);
  if (!key) return null;
  const step = Math.floor(now / 1000 / period);
  const left = period - Math.floor(now / 1000) % period;
  return { code: hotp(key, step), next_code: hotp(key, step + 1), seconds_left: left, period };
}

// Where a profile keeps its 2FA key: AdsPower's own 2FA field first, then the remark —
// only when the key is labelled («2FA: …») or is part of a 2FA-site link. Unlabelled runs
// in «login|password|…» lines are not guessed: a password or mail token must never be taken for a key.
// Unspaced of any length, or groups of 4 with a shorter last group: a key is never cut to a multiple of 4.
const B32 = '[A-Z2-7]{16,128}|[A-Z2-7]{4}(?: [A-Z2-7]{4}){3,31}(?: [A-Z2-7]{1,3})?';
const LABELLED = [
  new RegExp(`2\\s?fa\\s*[:=\\-–]\\s*(${B32})`, 'i'),
  new RegExp(`(?:2fa\\.(?:fb\\.tools|live|cn)|fb\\.tools/2fa)/(${B32})`, 'i'),
];

export function findKey(profile) {
  const fb = (profile.platform_account || []).find(a => String(a.domain_name || '').includes('facebook'));
  for (const [v, source] of [[fb?.fakey, 'AdsPower: аккаунт Facebook'], [profile.fakey, 'AdsPower: поле 2FA профиля']]) {
    if (base32(v || '')) return { key: v, source };
  }
  const r = String(profile.remark || '');
  for (const re of LABELLED) {
    const m = r.match(re);
    if (m && base32(m[1])) return { key: m[1], source: 'заметка профиля (подписан как 2FA)' };
  }
  return null;
}
