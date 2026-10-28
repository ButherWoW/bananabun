import { readSecret, GRAPH_VERSION, redact } from './common.js';

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
    ws.onerror = () => reject(new Error('CDP socket error: profile closed or WS_FILE is stale'));
    // A closed tab or profile must fail pending calls, not hang the agent forever.
    ws.onclose = () => {
      for (const p of pending.values()) p.reject(new Error('CDP closed: the profile tab was closed'));
      pending.clear();
    };
    ws.onopen = () => resolve({
      send(method, params = {}, timeoutMs = 150000) {
        return new Promise((res, rej) => {
          const n = ++id;
          const t = setTimeout(() => { pending.delete(n); rej(new Error(`CDP ${method} timed out`)); }, timeoutMs);
          pending.set(n, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      },
      close() { ws.close(); },
    });
  });
}

// Runs fetch() inside a profile page, so the request leaves through the profile.
// Ads Manager tokens are session-bound: Graph accepts them only with the profile's cookies.
function fetchExpression(url, init, timeoutMs) {
  return `(async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ${timeoutMs});
    try {
      const init = ${JSON.stringify(init)};
      if (init.form) { init.body = new URLSearchParams(init.form); delete init.form; }
      const r = await fetch(${JSON.stringify(url)}, { ...init, credentials: 'include', signal: ctl.signal });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: 0, body: JSON.stringify({ transport_error: String(e) }) };
    } finally { clearTimeout(t); }
  })()`;
}

export class Graph {
  constructor({ wsFile = process.env.WS_FILE, tokenFile = process.env.TOKEN_FILE, wsUrl, token, version = GRAPH_VERSION } = {}) {
    this.wsUrl = wsUrl || readSecret(wsFile, 'WS_FILE');
    this.token = token || readSecret(tokenFile, 'TOKEN_FILE');
    this.version = version;
  }

  async open() { this.cdp = await connect(this.wsUrl); return this; }
  close() { this.cdp?.close(); }

  async call(method, pathAndQuery, params = {}, timeoutMs = 75000) {
    const base = `https://graph.facebook.com/${this.version}/${pathAndQuery.replace(/^\//, '')}`;
    const url = new URL(base);
    let init = { method };
    if (method === 'GET') {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      url.searchParams.set('access_token', this.token);
    } else {
      const form = { access_token: this.token };
      for (const [k, v] of Object.entries(params)) form[k] = typeof v === 'string' ? v : JSON.stringify(v);
      init.form = form;
    }
    const res = await this.cdp.send('Runtime.evaluate', {
      expression: fetchExpression(url.toString(), init, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    const { status, body } = res.result.value;
    let data;
    try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
    const out = { status, data };
    if (data?.error?.code === 190) out.fatal = 'token dead (code 190): get a fresh token from the profile';
    return JSON.parse(redact(out));
  }

  get(p, params, t) { return this.call('GET', p, params, t); }
  post(p, params, t) { return this.call('POST', p, params, t); }
}

export function isOk(r) { return r.status === 200 && !r.data?.error; }
