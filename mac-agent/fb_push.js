#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… fb_push.js <spec.json> [--go]
// One campaign → N identical adsets → every creative in every adset. Everything is created PAUSED.
// Without --go only prints the plan. Idempotent: state is kept in <spec>.state.json, reruns add only what is missing.
import fs from 'node:fs';
import path from 'node:path';
import { Graph } from './lib/cdp.js';
import { die, readJson, writeJson } from './lib/common.js';
import { checkSpec, emptyState, planText, runFbPush } from './lib/fbpush.js';

const [specFile, ...flags] = process.argv.slice(2);
if (!specFile) die('usage: fb_push.js <spec.json> [--go]');
const go = flags.includes('--go');
const spec = readJson(specFile);
spec.creatives = (spec.creatives || []).map((c) => ({ ...c, file: c.file || c.image }));
const stateFile = specFile.replace(/\.json$/, '') + '.state.json';
const state = fs.existsSync(stateFile) ? readJson(stateFile) : emptyState();
const save = () => writeJson(stateFile, state);

try { checkSpec(spec); } catch (e) { die(e.message); }
for (const c of spec.creatives) if (!fs.existsSync(c.file)) die(`image not found: ${c.file}`);

console.log(planText(spec, state));
if (!go) { console.log('\nPlan only. Rerun with --go to create (everything PAUSED).'); process.exit(0); }

const g = await new Graph().open();
try {
  await runFbPush(g, spec, state, save, (m) => console.log(m));
} catch (e) {
  save(); g.close();
  die(e.message, e.fatal ? 2 : 1);
}
g.close();
console.log(`\nDone, all PAUSED. campaign_id ${state.campaign_id} (= sub_id_2 in Keitaro), ${Object.keys(state.ads).length} ads. State: ${path.basename(stateFile)}`);
