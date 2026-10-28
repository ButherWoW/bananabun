import React, { useEffect, useState } from 'react';

// TOTP (RFC 6238: SHA-1, 6 digits, 30 s) in the browser — the key never leaves the page.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function cleanSecret(s) {
  return String(s || '').toUpperCase().replace(/[\s=-]/g, '');
}

function base32(secret) {
  const s = cleanSecret(secret);
  if (!/^[A-Z2-7]{16,128}$/.test(s)) return null;
  let bits = '';
  for (const c of s) bits += ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function totpCode(secret, now = Date.now()) {
  const key = base32(secret);
  if (!key) return null;
  const counter = Math.floor(now / 1000 / 30);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, counter);
  new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

export function secondsLeft(now = Date.now()) {
  return 30 - (Math.floor(now / 1000) % 30);
}

export function useTick(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function CodeDisplay({ code, left, small }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e?.stopPropagation();
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  const low = left <= 5;
  return (
    <button type="button" onClick={copy} title="Скопировать"
      className={`inline-flex items-center gap-2 rounded-lg border border-[color:var(--c2d3148)] bg-[color:var(--c0d0f1e)] ${small ? 'px-2 py-1' : 'px-4 py-2'} font-mono`}>
      <span className={`${small ? 'text-sm' : 'text-2xl'} tracking-[0.2em] font-bold ${low ? 'text-amber-400' : 'text-teal-300'}`}>
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <span className={`text-[10px] ${low ? 'text-amber-400' : 'text-gray-500'}`}>{left}с</span>
      <span className="text-[10px] text-gray-500">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

// Code of an account's AdsPower profile, computed by the Mac agent. When the received code expires,
// the next one (sent along) is shown; after that a new request is needed.
export function AccountTwoFa({ request }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const now = useTick();

  async function get(e) {
    e?.stopPropagation();
    setBusy(true);
    try {
      const r = await request();
      setState({ ...r, received: Date.now() });
    } catch (err) {
      setState({ error: err?.error || err?.message || 'Не удалось получить код' });
    } finally { setBusy(false); }
  }

  let view = null;
  if (state?.code) {
    const passed = Math.floor((now - state.received) / 1000);
    const left = state.seconds_left - passed;
    if (left > 0) view = <CodeDisplay small code={state.code} left={left} />;
    else if (left + 30 > 0) view = <CodeDisplay small code={state.next_code} left={left + 30} />;
  }

  return (
    <span className="inline-flex items-center gap-2" onClick={e => e.stopPropagation()}>
      {view}
      {!view && (
        <button type="button" onClick={get} disabled={busy}
          title={state?.source ? `Ключ: ${state.source}` : 'Код 2FA профиля: агент считает его на Mac, ключ наружу не уходит'}
          className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-teal-700/40 text-gray-300 hover:text-teal-300 transition-colors disabled:opacity-50">
          {busy ? '2FA…' : '🔐 2FA'}
        </button>
      )}
      {state?.error && !view && <span className="text-[11px] text-red-400 max-w-[220px]">{state.error}</span>}
    </span>
  );
}
