import { db } from '../../db/client.js';
import { deviceOf, osOf, appOf } from '../../services/lp-tracker.js';

const EVENTS = new Set(['view', 'seen', 'depth', 'click', 'buy_click', 'bundle_select', 'quiz_answer', 'leave']);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const idOr = (v) => (ID.test(String(v || '')) ? String(v) : null);

let lastPrune = 0;

// Public endpoint for the landing tracker: no auth (the page is on the tracker's domain),
// text/plain body so the browser sends it without a CORS preflight. Answers 204 whatever comes.
export async function trackRoutes(app) {
  app.post('/', { logLevel: 'warn', bodyLimit: 64 * 1024 }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*').status(204);
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
    const rows = events.filter(e => EVENTS.has(e?.e));
    if (!rows.length) return reply.send();

    const vals = [];
    const ph = rows.map((e, i) => {
      vals.push(...base, e.e, clip(e.b, 40), Number.isFinite(Number(e.n)) && e.n !== null ? Math.round(Number(e.n)) : null);
      const o = i * 16;
      return `(${Array.from({ length: 16 }, (_, k) => `$${o + k + 1}`).join(',')})`;
    });
    await db.query(`INSERT INTO lp_events (visitor, campaign_id, adset_id, ad_id, template_id, product_id, geo,
                      device, os, app, placement, source, country, event, block, num) VALUES ${ph.join(',')}`, vals)
      .catch((e) => req.log.warn({ err: e.message }, 'lp_events insert failed'));

    // Keep 30 days, pruned at most once an hour.
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      db.query(`DELETE FROM lp_events WHERE at < NOW() - INTERVAL '30 days'`).catch(() => {});
    }
    return reply.send();
  });
}
