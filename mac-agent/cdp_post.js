#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… cdp_post.js <path> <params.json> <out.json>
import { Graph } from './lib/cdp.js';
import { die, readJson, writeJson } from './lib/common.js';

const [p, paramsFile, out] = process.argv.slice(2);
if (!p || !paramsFile || !out) die('usage: cdp_post.js <path> <params.json> <out.json>');
const g = await new Graph().open();
const r = await g.post(p, readJson(paramsFile));
g.close();
writeJson(out, r);
console.log(`status ${r.status}${r.data?.error ? ` error ${r.data.error.code}/${r.data.error.error_subcode ?? '-'}: ${r.data.error.message}` : ''}`);
if (r.fatal) die(r.fatal, 2);
process.exit(r.status === 200 ? 0 : 1);
