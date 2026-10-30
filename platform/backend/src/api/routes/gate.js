// /gate/* is outside /api on purpose: the site's /api/ proxy never reaches it and port 4000 is closed, so it is only
// reachable through nginx-banana.conf — /_gate/unlock (X-Real-IP set by nginx) and the internal /_gate/check/<door>.
import { DOORS, PIN_RE, createLimiter, hasPass, parsePins, passCookie } from '../../services/gate.js';

export async function gateRoutes(app, { env = process.env, limiter = createLimiter() } = {}) {
  const secret = env.GATE_SECRET || '';
  const pins = parsePins(env.GATE_PINS);
  const ready = secret.length >= 32 && pins.size > 0;
  if (!ready) app.log.warn('gate: GATE_SECRET or GATE_PINS is not set, every door stays closed');

  app.post('/unlock', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!ready) return reply.status(503).send({ error: 'gate_not_configured' });
    const ip = String(req.headers['x-real-ip'] || req.ip);
    if (limiter.blocked(ip)) return reply.status(429).send({ error: 'locked' });
    const pin = String(req.body?.pin ?? '');
    const door = PIN_RE.test(pin) ? pins.get(pin) : undefined;
    if (!door) {
      limiter.fail(ip);
      return reply.status(401).send({ error: 'wrong_pin' });
    }
    reply.header('set-cookie', passCookie(secret, door));
    return { to: DOORS[door].to };
  });

  // nginx auth_request: 204 lets the page through, 401 makes nginx answer 404.
  app.get('/check/:door', async (req, reply) => {
    const ok = ready && hasPass(secret, req.params.door, req.headers.cookie);
    return reply.status(ok ? 204 : 401).send();
  });
}
