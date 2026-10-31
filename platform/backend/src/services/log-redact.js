// What request logs may show of a URL: the Keitaro postback path carries a team secret, so it is masked.
export function redactUrl(url = '') {
  return String(url).replace(/(\/keitaro-postback\/)[^/?#]+/g, '$1•••');
}

// Fastify request serializer with the URL masked (the default one logs req.url as is).
export function reqSerializer(req) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
