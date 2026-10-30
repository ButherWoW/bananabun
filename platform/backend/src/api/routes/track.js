import { db } from '../../db/client.js';
import { deviceOf, osOf, appOf } from '../../services/lp-tracker.js';

const EVENTS = new Set(['view', 'seen', 'depth', 'click', 'buy_click', 'bundle_select', 'quiz_answer', 'leave', 'rage', 'dead']);
// Element label from the page script (tag#id.class «caption»): printable text only, capped.
const elOf = (e) => (e.e === 'rage' || e.e === 'dead') && typeof e.el === 'string'
  ? (e.el.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || null) : null;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const idOr = (v) => (ID.test(String(v || '')) ? String(v) : null);

let lastPrune = 0;

// Per-visitor-IP limit: a real page sends a few beacons a minute. The IP comes from nginx's X-Real-IP,
// trusted only when the request itself came from the local proxy.
const LIMIT = 120;
const hits = new Map();
function clientIp(req) {
  const local = /^(127\.|::1$|::ffff:127\.)/.test(String(req.ip || ''));
  return local && req.headers['x-real-ip'] ? String(req.headers['x-real-ip']) : String(req.ip || '');
}
function overLimit(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60000) { hits.set(ip, { at: now, n: 1 }); }
  else if (++h.n > LIMIT) return true;
  if (hits.size > 50000) for (const [k, v] of hits) if (now - v.at > 60000) hits.delete(k);
  return false;
}

// Public endpoint for the landing tracker: no auth (the page is on the tracker's domain),
// text/plain body so the browser sends it without a CORS preflight. Answers 204 whatever comes.
export async function trackRoutes(app) {
  app.post('/', { logLevel: 'warn', bodyLimit: 64 * 1024 }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*').status(204);
    if (overLimit(clientIp(req))) return reply.send();
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return reply.send(); } }
    const m = body?.m || {};
    const events = Array.isArray(body?.ev) ? body.ev.slice(0, 200) : [];
    const visitor = idOr(m.v);
    if (!visitor || !events.length) return reply.send();

    const ua = String(req.headers['user-agent'] || '');
    const country = /^[A-Z]{2}$/.test(String(req.headers['cf-ipcountry'] || '')) ? req.headers['cf-ipcountry'] : null;
    const base = [
      visitor, idOr(m.c), idOr(m.s), idOr(m.a), idOr(m.t), idOr(m.p), clip(m.g, 4),
      deviceOf(ua, Number(m.w) || 0), osOf(ua), appOf(ua), clip(m.pl, 60), clip(m.src, 40), country,
    ];
    // A real page sends a handful of events per beacon; more is noise or abuse.
    const rows = events.filter(e => EVENTS.has(e?.e)).slice(0, 50);
    if (!rows.length) return reply.send();
    const int32 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null
      : Math.max(-2147483648, Math.min(2147483647, Math.round(Number(v)))));

    const vals = [];
    const ph = rows.map((e, i) => {
      vals.push(...base, e.e, clip(e.b, 40), int32(e.n), elOf(e));
      const o = i * 17;
      return `(${Array.from({ length: 17 }, (_, k) => `$${o + k + 1}`).join(',')})`;
    });
    await db.query(`INSERT INTO lp_events (visitor, campaign_id, adset_id, ad_id, template_id, product_id, geo,
                      device, os, app, placement, source, country, event, block, num, el) VALUES ${ph.join(',')}`, vals)
      .catch((e) => req.log.warn({ err: e.message }, 'lp_events insert failed'));

    // Keep 30 days, pruned at most once an hour.
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      db.query(`DELETE FROM lp_events WHERE at < NOW() - INTERVAL '30 days'`).catch(() => {});
    }
    return reply.send();
  });
}
