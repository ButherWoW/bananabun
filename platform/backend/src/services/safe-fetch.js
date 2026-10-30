// Downloads from addresses a user typed or a scraped page gave us. Every hop (the first URL and each redirect)
// is checked, and the check runs on the address the socket actually connects to, so a DNS answer that changes
// between "check" and "connect" cannot point us at the server itself or the private network.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(ip, bits, 'ipv6');

export function isPrivateAddress(address) {
  const a = String(address).replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) return isPrivateAddress(mapped[1]);
  const family = net.isIP(a);
  if (!family) return true;
  return blocked.check(a, family === 4 ? 'ipv4' : 'ipv6');
}

function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some(a => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error('Адрес закрыт для загрузки'), { code: 'BLOCKED_ADDRESS' }));
    }
    cb(null, address, family);
  });
}

function getOnce(url, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: timeoutMs, headers: { 'user-agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location || '', u).href });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Загрузка не удалась: HTTP ${res.statusCode}`));
      }
      if (Number(res.headers['content-length']) > maxBytes) {
        res.destroy();
        return reject(new Error('Файл слишком большой'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error('Файл слишком большой')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Загрузка не ответила вовремя')));
    req.on('error', reject);
  });
}

// Returns { body: Buffer, type } or throws. Only http(s), at most `maxRedirects` hops.
export async function safeDownload(url, { maxBytes = 20 * 1024 * 1024, timeoutMs = 15000, maxRedirects = 3 } = {}) {
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u;
    try { u = new URL(current); } catch { throw new Error('Неверный адрес'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Разрешены только http и https');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(u.hostname)) {
      throw Object.assign(new Error('Адрес закрыт для загрузки'), { code: 'BLOCKED_ADDRESS' });
    }
    const res = await getOnce(current, { maxBytes, timeoutMs });
    if (!res.redirect) return res;
    current = res.redirect;
  }
  throw new Error('Слишком много перенаправлений');
}
