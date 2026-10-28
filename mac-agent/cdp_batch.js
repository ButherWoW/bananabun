#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… cdp_batch.js <get|post|post-soft> <jobs.json> <out.json>
// jobs.json: [{ "path": "act_1/campaigns", "params": {...} }, ...]
// get: pause 250 ms; post: pause 350 ms, stops on first error; post-soft: continues after errors.
import { Graph, isOk } from './lib/cdp.js';
import { die, readJson, sleep, writeJson } from './lib/common.js';

const [mode, jobsFile, out] = process.argv.slice(2);
if (!['get', 'post', 'post-soft'].includes(mode) || !jobsFile || !out) die('usage: cdp_batch.js <get|post|post-soft> <jobs.json> <out.json>');

const jobs = readJson(jobsFile);
const g = await new Graph().open();
const results = [];
let failed = 0;
for (const [i, job] of jobs.entries()) {
  const r = mode === 'get' ? await g.get(job.path, job.params) : await g.post(job.path, job.params);
  results.push({ i, path: job.path, ...r });
  if (r.fatal) { writeJson(out, results); g.close(); die(r.fatal, 2); }
  if (!isOk(r)) {
    failed++;
    console.log(`#${i} ${job.path}: status ${r.status} ${r.data?.error?.message ?? ''}`);
    if (mode === 'post') { console.log('stopped on first error'); break; }
  }
  await sleep(mode === 'get' ? 250 : 350);
}
g.close();
writeJson(out, results);
console.log(`${results.length}/${jobs.length} done, ${failed} failed → ${out}`);
process.exit(failed ? 1 : 0);
