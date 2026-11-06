import test from 'node:test';
import assert from 'node:assert/strict';
import { settleFastScrape } from '../src/services/scrape-jobs.js';
import { db } from '../src/db/client.js';

test('fast scrape: a failed fetch hands the job to the agent, a failed apply does not', async (t) => {
  const saved = db.query;
  const queries = [];
  db.query = async (sql) => { queries.push(String(sql)); return { rows: [] }; };
  t.after(() => { db.query = saved; });
  const origError = console.error, origWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  t.after(() => { console.error = origError; console.warn = origWarn; });

  await settleFastScrape('w', 5, 'amazon/X', Promise.reject(new Error('timeout')), async () => { throw new Error('must not apply'); });
  assert.ok(queries.some(q => /status = 'pending'/.test(q)), 'fetch failure resets the job to pending');

  queries.length = 0;
  await settleFastScrape('w', 6, 'amazon/X', Promise.resolve({ title: 't' }), async () => { throw new Error('apply broke'); });
  assert.ok(queries.some(q => /status = 'done'/.test(q)));
  assert.ok(!queries.some(q => /status = 'pending'/.test(q)), 'an apply error must not reset a done job');
});
