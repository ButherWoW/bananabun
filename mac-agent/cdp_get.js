#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… cdp_get.js <path?query> <out.json> [version]
import { Graph } from './lib/cdp.js';
import { die, writeJson } from './lib/common.js';

const [p, out, version] = process.argv.slice(2);
if (!p || !out) die('usage: cdp_get.js <path> <out.json> [version]');
const g = await new Graph(version ? { version } : {}).open();
const [route, qs] = p.split('?');
const r = await g.get(route, Object.fromEntries(new URLSearchParams(qs || '')));
g.close();
writeJson(out, r);
console.log(`status ${r.status}${r.data?.error ? ` error ${r.data.error.code}/${r.data.error.error_subcode ?? '-'}: ${r.data.error.message}` : ''}`);
if (r.fatal) die(r.fatal, 2);
process.exit(r.status === 200 ? 0 : 1);
