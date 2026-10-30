// Counts failed attempts per key in a sliding window, in this process's memory (one backend process on the server).
export function attemptLimiter({ max, windowMs }) {
  const hits = new Map();
  const fresh = (key, now) => (hits.get(key) || []).filter(t => now - t < windowMs);
  return {
    blocked(key, now = Date.now()) {
      const list = fresh(key, now);
      if (list.length) hits.set(key, list); else hits.delete(key);
      return list.length >= max;
    },
    fail(key, now = Date.now()) {
      const list = fresh(key, now);
      list.push(now);
      hits.set(key, list);
      if (hits.size > 10000) for (const k of hits.keys()) { if (!fresh(k, now).length) hits.delete(k); }
    },
    clear(key) { hits.delete(key); },
    reset() { hits.clear(); },
  };
}

// Behind nginx the socket address is loopback; the client address then comes from X-Real-IP (as in routes/track.js).
export function clientIp(req) {
  const local = /^(127\.|::1$|::ffff:127\.)/.test(String(req.ip || ''));
  return local && req.headers['x-real-ip'] ? String(req.headers['x-real-ip']) : String(req.ip || '');
}
