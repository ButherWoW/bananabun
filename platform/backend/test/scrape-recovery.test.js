import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Own scrape against a real PostgreSQL: result applied once, stale results ignored after a retry,
// recovery after a restart, concurrent recovery workers, stuck scrapes fail and cancel their job.
const testUrl = process.env.BANANABUN_TEST_DATABASE_URL;
const IMAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'images');

test('own scrape survives restarts', { skip: !testUrl }, async t => {
  const url = new URL(testUrl);
  assert.ok(url.pathname.endsWith('_test'), 'Use an explicit disposable *_test database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Test database must be local');
  const schema = `scrape_recovery_${process.pid}`;
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { db, pool } = await import('../src/db/client.js');

  // Only Amazon's image CDN answers; anything else counts as an attempted outside call.
  const fetchSaved = globalThis.fetch;
  const outside = [];
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (['media-amazon.com','walmartimages.com','target.scene7.com','bbystatic.com','etsystatic.com'].some(host=>u.hostname===host || u.hostname.endsWith('.'+host))) {
      return new Response(Buffer.alloc(4096, 7), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    outside.push(u.href);
    throw new Error('external request forbidden');
  };
  const written = [];
  t.after(async () => {
    globalThis.fetch = fetchSaved;
    for (const f of written) await rm(join(IMAGES_DIR, f), { force: true });
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../src/db/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  await pool.query(`
    INSERT INTO workspaces(id,name) VALUES ('w1','First');
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES ('a','w1','a@test.invalid','A','test','buyer');`);
  const product = async (id, extra = '') => pool.query(
    `INSERT INTO products(id,workspace_id,created_by,source,source_id,marketplace,scrape_status,bundle_config ${extra ? ',scrape_started_at' : ''})
     VALUES ($1,'w1','a','amazon','B0TEST0001','fr','processing',$2::jsonb ${extra ? `,NOW() - INTERVAL '${extra}'` : ''})`,
    [id, JSON.stringify([{ qty: '2', price: '99.00', currency: 'EUR', offer_id: 313 }])]);
  const row = async (id) => (await db.query('SELECT * FROM products WHERE id = $1', [id])).rows[0];
  const job = async (id) => (await db.query('SELECT status, result FROM agent_jobs WHERE id = $1', [id])).rows[0];
  const page = { title: 'Real title', price: 76.49, rating: 4.2, reviews_count: 231, description: 'Desc',
    images: ['https://m.media-amazon.com/images/I/a.jpg', 'https://evil.example/x.jpg'], has_photo_reviews: true };
  const remember = (p) => (p.images || []).forEach(u => written.push(String(u).split('/').pop()));

  const { enqueueOwnScrape, applyScrapeResult, recoverScrapes } = await import('../src/services/scrape-jobs.js');

  await t.test('result is applied to the product that waits for exactly this job', async () => {
    await product('p1');
    const jobId = await enqueueOwnScrape('w1', 'p1', 'B0TEST0001', 'fr');
    assert.equal(String((await row('p1')).scrape_job_id), String(jobId));
    await applyScrapeResult('w1', jobId, true, page);
    const p = await row('p1'); remember(p);
    assert.equal(p.scrape_status, 'done');
    assert.equal(p.title, 'Real title');
    assert.equal(Number(p.source_price), 76.49);
    assert.equal(p.images.length, 1, 'only the Amazon CDN image is downloaded');
    assert.match(p.images[0], /^\/uploads\/images\/B0TEST0001-0-[A-Za-z0-9_-]{10}\.jpg$/);
    assert.equal(p.bundle_config[0].old_price, '152.98', 'old price from the real price × paid quantity');
    // A second report of the same job changes nothing.
    await applyScrapeResult('w1', jobId, true, { ...page, title: 'Changed' });
    assert.equal((await row('p1')).title, 'Real title');
  });

  await t.test('old result is ignored after «Ещё раз»', async () => {
    await product('p2');
    const oldJob = await enqueueOwnScrape('w1', 'p2', 'B0TEST0001', 'fr');
    const newJob = await enqueueOwnScrape('w1', 'p2', 'B0TEST0001', 'fr');
    await applyScrapeResult('w1', oldJob, true, { ...page, title: 'Stale' });
    let p = await row('p2');
    assert.equal(p.scrape_status, 'processing');
    assert.notEqual(p.title, 'Stale');
    await applyScrapeResult('w1', newJob, true, page);
    p = await row('p2'); remember(p);
    assert.equal(p.scrape_status, 'done');
  });

  await t.test('finished but unapplied result is recovered, also by two workers at once', async () => {
    await product('p3');
    const jobId = await enqueueOwnScrape('w1', 'p3', 'B0TEST0001', 'fr');
    // The agent reported while the backend was down: the job is done, the product still waits.
    await db.query(`UPDATE agent_jobs SET status='done', result=$2 WHERE id=$1`, [jobId, JSON.stringify({ ok: true, data: page })]);
    await Promise.all([recoverScrapes(), recoverScrapes()]);
    const p = await row('p3'); remember(p);
    assert.equal(p.scrape_status, 'done');
    assert.equal(p.title, 'Real title');
  });

  await t.test('failed agent job fails the product with its reason', async () => {
    await product('p4');
    const jobId = await enqueueOwnScrape('w1', 'p4', 'B0TEST0001', 'fr');
    await applyScrapeResult('w1', jobId, false, null, 'Проверка на робота — пройдите её в профиле');
    const p = await row('p4');
    assert.equal(p.scrape_status, 'failed');
    assert.match(p.scrape_error, /робота/);
  });

  await t.test('stuck scrape fails and cancels its queued job; legacy rows without a job fail too', async () => {
    await product('p5');
    const jobId = await enqueueOwnScrape('w1', 'p5', 'B0TEST0001', 'fr');
    await db.query(`UPDATE products SET scrape_started_at = NOW() - INTERVAL '20 minutes' WHERE id = 'p5'`);
    await product('p6', '20 minutes'); // started before this change: no job id
    await recoverScrapes();
    assert.equal((await row('p5')).scrape_status, 'failed');
    assert.equal((await job(jobId)).status, 'failed', 'queued job is cancelled');
    const legacy = await row('p6');
    assert.equal(legacy.scrape_status, 'failed');
    assert.match(legacy.scrape_error, /Ещё раз/);
  });

  const { runPresetCreatives } = await import('../src/services/scrape-jobs.js');
  await pool.query(`INSERT INTO creative_presets(id,workspace_id,created_by,name,template)
                    VALUES ('cp1','w1','a','Preset','{"count":1,"format":"1x1","language":"fr"}')`);
  const batches = async (id) => Number((await db.query('SELECT count(*) FROM creatives WHERE product_id = $1', [id])).rows[0].count);

  await t.test('preset creatives are queued exactly once after the scrape', async () => {
    await product('p7');
    await db.query(`UPDATE products SET creative_preset_id = 'cp1' WHERE id = 'p7'`);
    const jobId = await enqueueOwnScrape('w1', 'p7', 'B0TEST0001', 'fr');
    await applyScrapeResult('w1', jobId, true, page);
    const p = await row('p7'); remember(p);
    assert.equal(await batches('p7'), 1);
    assert.equal(p.preset_creatives_due_at, null, 'the mark is cleared once queued');
    await Promise.all([recoverScrapes(), recoverScrapes()]);
    assert.equal(await batches('p7'), 1, 'recovery does not generate again');
  });

  await t.test('crash right after «done»: recovery queues the preset once, even with two workers', async () => {
    await product('p8');
    await db.query(`UPDATE products SET creative_preset_id = 'cp1', scrape_status = 'done',
                    preset_creatives_due_at = NOW() - INTERVAL '2 minutes' WHERE id = 'p8'`);
    await Promise.all([recoverScrapes(), recoverScrapes(), runPresetCreatives('w1', 'p8')]);
    assert.equal(await batches('p8'), 1);
    assert.equal((await row('p8')).preset_creatives_due_at, null);
  });

  await t.test('crash after the batch insert: the mark is cleared without a second batch', async () => {
    await product('p9');
    await db.query(`UPDATE products SET creative_preset_id = 'cp1', scrape_status = 'done', scrape_job_id = 999,
                    preset_creatives_due_at = NOW() - INTERVAL '2 minutes' WHERE id = 'p9'`);
    // This scrape's batch was inserted, then the process died before the mark was cleared.
    await pool.query(`INSERT INTO creatives(id,workspace_id,created_by,product_id,status,metadata)
                      VALUES ('existing','w1','a','p9','pending','{"source":"local","auto_batch_key":"scrape:999","auto_slot":0}')`);
    await recoverScrapes();
    assert.equal(await batches('p9'), 1);
    assert.equal((await row('p9')).preset_creatives_due_at, null);
  });

  await t.test('a manual generation after the scrape does not suppress the automatic batch', async () => {
    await product('p11');
    await db.query(`UPDATE products SET creative_preset_id = 'cp1', scrape_status = 'done', scrape_job_id = 1001,
                    preset_creatives_due_at = NOW() - INTERVAL '2 minutes' WHERE id = 'p11'`);
    await pool.query(`INSERT INTO creatives(id,workspace_id,created_by,product_id,status,metadata)
                      VALUES ('manual','w1','a','p11','pending','{"source":"local"}')`);
    await recoverScrapes();
    assert.equal(await batches('p11'), 2, 'manual + automatic');
    const { rows } = await db.query(`SELECT metadata->>'auto_batch_key' AS k FROM creatives WHERE product_id = 'p11' AND id <> 'manual'`);
    assert.equal(rows[0].k, 'scrape:1001');
  });

  await t.test('a failed preset generation keeps the mark, counts attempts, stops after 3 with the reason', async () => {
    await pool.query(`INSERT INTO creative_presets(id,workspace_id,created_by,name,template)
                      VALUES ('cpbad','w1','a','Broken','{"format":"7x7"}')`);
    await product('p10');
    await db.query(`UPDATE products SET creative_preset_id = 'cpbad' WHERE id = 'p10'`);
    const jobId = await enqueueOwnScrape('w1', 'p10', 'B0TEST0001', 'fr');
    await applyScrapeResult('w1', jobId, true, page);
    let p = await row('p10'); remember(p);
    assert.equal(p.scrape_status, 'done');
    assert.notEqual(p.preset_creatives_due_at, null, 'the mark survives a failed attempt');
    assert.equal(p.preset_creatives_attempts, 1);
    assert.ok(p.preset_creatives_error, 'the reason is stored');
    await runPresetCreatives('w1', 'p10');
    await runPresetCreatives('w1', 'p10');
    p = await row('p10');
    assert.equal(p.preset_creatives_attempts, 3);
    assert.equal(p.preset_creatives_due_at, null, 'no endless retries');
    assert.ok(p.preset_creatives_error);
    assert.equal(await batches('p10'), 0);
  });

  await t.test('Walmart: own job type, Walmart CDN photos, no cross-currency old price', async () => {
    const { parseProductLink } = await import('../src/services/engine.js');
    const link = parseProductLink('https://www.walmart.com/ip/Ninja-CREAMi-Deluxe-NC501/1736263368?sid=x');
    assert.deepEqual(link, { source: 'walmart', asin: '1736263368', marketplace: 'us', url: 'https://www.walmart.com/ip/1736263368' });
    assert.equal(parseProductLink('https://www.walmart.com/browse/kitchen').asin, undefined, 'a category is not a product');
    await pool.query(`INSERT INTO products(id,workspace_id,created_by,source,source_id,marketplace,scrape_status,bundle_config)
      VALUES ('pw','w1','a','walmart','1736263368','us','processing',$1::jsonb)`,
      [JSON.stringify([{ qty: '2', price: '199.00', currency: 'EUR', offer_id: 313 }])]);
    const jobId = await enqueueOwnScrape('w1', 'pw', '1736263368', 'us', 'walmart');
    const j = (await db.query('SELECT type, payload FROM agent_jobs WHERE id = $1', [jobId])).rows[0];
    assert.equal(j.type, 'scrape_walmart');
    assert.equal(j.payload.url, 'https://www.walmart.com/ip/1736263368');
    await applyScrapeResult('w1', jobId, true, {
      title: 'Ninja CREAMi Deluxe', price: 249.99, currency: 'USD', rating: 4.3, reviews_count: 941,
      images: ['https://i5.walmartimages.com/seo/a.jpeg', 'https://evil.example/b.jpeg'], description: 'Real text',
    });
    const p = await row('pw'); remember(p);
    assert.equal(p.scrape_status, 'done');
    assert.equal(Number(p.source_price), 249.99);
    assert.equal(p.images.length, 1, 'only the Walmart CDN photo');
    assert.equal(p.bundle_config[0].old_price, '', 'a USD price is never an old price for a EUR bundle');
    await assert.rejects(enqueueOwnScrape('w1', 'pw', 'not-an-id', 'us', 'walmart'), /walmart\.com\/ip/);
  });

  for (const shop of [
    {source:'target',id:'91863920',url:'https://www.target.com/p/fixture/-/A-91863920',image:'https://target.scene7.com/is/image/Target/fixture'},
    {source:'bestbuy',id:'J3GW7QQSXX',url:'https://www.bestbuy.com/product/fixture/J3GW7QQSXX',image:'https://pisces.bbystatic.com/fixture.jpg'},
    {source:'etsy',id:'1234567890',url:'https://www.etsy.com/listing/1234567890/fixture',image:'https://i.etsystatic.com/fixture.jpg'},
  ]) await t.test(shop.source+': durable job, local photos, replay and failure reason', async()=>{
    const id='new_'+shop.source;
    await pool.query(`INSERT INTO products(id,workspace_id,created_by,source,source_id,source_url,scrape_status)
      VALUES ($1,'w1','a',$2,$3,$4,'processing')`,[id,shop.source,shop.id,shop.url]);
    const jobId=await enqueueOwnScrape('w1',id,shop.id,'us',shop.source,shop.url);
    const queued=(await db.query('SELECT type,payload FROM agent_jobs WHERE id=$1',[jobId])).rows[0];
    assert.equal(queued.type,'scrape_'+shop.source);assert.equal(queued.payload.url,shop.url);
    const data={title:'Synthetic '+shop.source,price:42.5,currency:'USD',rating:null,reviews_count:null,images:[shop.image,'https://evil.example/fixture.jpg','https://target.scene7.com.evil.example/fixture.jpg']};
    await db.query(`UPDATE agent_jobs SET status='done',result=$2 WHERE id=$1`,[jobId,JSON.stringify({ok:true,data})]);
    await Promise.all([recoverScrapes(),recoverScrapes()]);
    const p=await row(id);remember(p);
    assert.equal(p.scrape_status,'done');assert.equal(p.title,data.title);assert.equal(p.images.length,1);
    assert.equal(p.source_currency,'USD');
    assert.equal(p.reviews_count,null,'unknown review count is not invented');
    await recoverScrapes();assert.deepEqual((await row(id)).images,p.images,'no duplicate photos after replay');
    await db.query("UPDATE products SET scrape_status='processing' WHERE id=$1",[id]);
    const retry=await enqueueOwnScrape('w1',id,shop.id,'us',shop.source,shop.url);
    await applyScrapeResult('w1',retry,false,null,'Robot check: manual action required');
    assert.equal((await row(id)).scrape_error,'Robot check: manual action required');
    await assert.rejects(enqueueOwnScrape('w1',id,'WRONG','us',shop.source,shop.url),/Invalid product URL/);
  });

  await t.test('no request left the test except the shops’ image CDNs', () => {
    assert.deepEqual(outside, [], 'image URLs outside the shops’ CDNs must be refused before any request');
  });
});
