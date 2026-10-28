#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… cdp_upload_img.js <act_id> <image> → prints image hash
import fs from 'node:fs';
import path from 'node:path';
import { Graph, isOk } from './lib/cdp.js';
import { die } from './lib/common.js';

export async function uploadImage(g, act, file) {
  const bytes = fs.readFileSync(file).toString('base64');
  const r = await g.post(`${act.startsWith('act_') ? act : 'act_' + act}/adimages`, { bytes, name: path.basename(file) }, 120000);
  if (!isOk(r)) throw new Error(`upload ${path.basename(file)}: status ${r.status} ${r.data?.error?.message ?? ''}`);
  return Object.values(r.data.images)[0].hash;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [act, file] = process.argv.slice(2);
  if (!act || !file) die('usage: cdp_upload_img.js <act_id> <image>');
  const g = await new Graph().open();
  try { console.log(await uploadImage(g, act, file)); } catch (e) { die(e.message); } finally { g.close(); }
}
