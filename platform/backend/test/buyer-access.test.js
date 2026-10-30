import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Fastify from 'fastify';

const testUrl = process.env.BANANABUN_TEST_DATABASE_URL;

test('buyer access against real PostgreSQL and Fastify routes', { skip: !testUrl }, async t => {
  const url = new URL(testUrl);
  assert.ok(url.pathname.endsWith('_test'), 'Use an explicit disposable *_test database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Test database must be local');
  const schema = `buyer_access_${process.pid}`;
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { db, pool } = await import('../src/db/client.js');
  const fetchSaved = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('External requests are forbidden in access tests'); };
  const app = Fastify();
  t.after(async () => {
    globalThis.fetch = fetchSaved;
    await app.close();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../src/db/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  // The migration is idempotent, and historical jobs are deliberately not assigned to buyers.
  await pool.query(await readFile(new URL('021_search_owner.sql', migrationDir), 'utf8'));
  await pool.query(`
    INSERT INTO workspaces(id,name) VALUES ('w1','First'),('w2','Second');
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES
      ('a','w1','a@test.invalid','A','test','buyer'), ('b','w1','b@test.invalid','B','test','buyer'),
      ('owner','w1','owner@test.invalid','Owner','test','owner'), ('lead','w1','lead@test.invalid','Lead','test','lead'),
      ('other','w2','other@test.invalid','Other','test','owner');
    INSERT INTO folders(id,workspace_id,name,created_by,shared) VALUES
      ('private_b','w1','Private B','b',false),('shared','w1','Shared','b',true),('foreign_folder','w2','Other','other',true);
    INSERT INTO products(id,workspace_id,created_by,title,folder_id,scrape_status) VALUES
      ('pa','w1','a','A product',NULL,'done'),('pa2','w1','a','A second',NULL,'done'),
      ('pb','w1','b','B product','shared','done'),('po','w2','other','Other product',NULL,'done');
    INSERT INTO creatives(id,workspace_id,created_by,product_id,status,file_url) VALUES
      ('ca','w1','a','pa','done','/uploads/ca.jpg'),('ca2','w1','a','pa2','done','/uploads/ca2.jpg'),
      ('broken','w1','a','pa','done',NULL),('cb','w1','b','pb','done','/uploads/cb.jpg'),('co','w2','other','po','done','/uploads/co.jpg');
    INSERT INTO product_reviews(id,product_id,author,text) VALUES ('ra','pa','real A','A review'),('rb','pb','real B','B review'),('ro','po','real other','Other review');
    INSERT INTO bundle_presets(id,workspace_id,created_by,name,config) VALUES ('bpa','w1','a','A','[]'),('bpb','w1','b','B','[]'),('bpo','w2','other','Other','[]');
    INSERT INTO creative_presets(id,workspace_id,created_by,name,template) VALUES ('cpa','w1','a','A','{}'),('cpb','w1','b','B','{}'),('cpo','w2','other','Other','{}');
    INSERT INTO landing_templates(id,workspace_id,created_by,name,html) VALUES ('lta','w1','a','A','<h1>{{title}}</h1>'),('ltb','w1','b','B','<h1>{{title}}</h1>'),('lto','w2','other','Other','<h1>{{title}}</h1>');
    INSERT INTO ad_settings(id,workspace_id,created_by,name) VALUES ('asa','w1','a','A'),('asb','w1','b','B'),('aso','w2','other','Other');
    INSERT INTO ad_presets(id,workspace_id,created_by,name) VALUES ('apa','w1','a','A'),('apb','w1','b','B'),('apo','w2','other','Other');
    INSERT INTO scrape_jobs(id,workspace_id,created_by,type,status,params) VALUES ('ja','w1','a','search','done','{}'),('jb','w1','b','search','done','{}'),('jo','w2','other','search','done','{}'),('legacy','w1',NULL,'search','done','{}');
    INSERT INTO campaigns(id,workspace_id,created_by,name,spend,revenue) VALUES ('cmpa','w1','a','A',10,20),('cmpb','w1','b','B',100,200),('cmpo','w2','other','Other',1000,2000);
    INSERT INTO tiktok_accounts(id,workspace_id,advertiser_id,access_token,name,created_by) VALUES ('tta','w1','adv1','test-token','TT','b');
    INSERT INTO ap_profiles(id,workspace_id,group_name) VALUES ('apa','w1','a@test.invalid'),('apb','w1','b@test.invalid');
    INSERT INTO fb_accounts(id,workspace_id,ap_profile_id) VALUES ('fba','w1','apa'),('fbb','w1','apb');
    INSERT INTO fb_cabinets(id,workspace_id,fb_account_id,external_id,name) VALUES
      ('cab_a1','w1','fba','act_111','A1'),('cab_a2','w1','fba','act_222','A2'),('cab_b','w1','fbb','act_333','B');
  `);
  const users = Object.fromEntries((await db.query('SELECT id,workspace_id AS ws,role,email FROM users')).rows.map(u => [u.id, u]));
  app.decorate('authenticate', async (req, reply) => {
    req.user = users[req.headers['x-test-user']];
    if (!req.user) return reply.code(401).send({ error: 'test login required' });
  });
  for (const [name, exported, prefix] of [
    ['products','productRoutes','products'], ['creatives','creativeRoutes','creatives'], ['push','pushRoutes','push'],
    ['folders','folderRoutes','folders'], ['presets','presetRoutes','presets'], ['landings','landingRoutes','landings'],
    ['search','searchRoutes','search'], ['adSettings','adSettingsRoutes','ad-settings'], ['adpresets','adPresetRoutes','ad-presets'], ['analytics','analyticsRoutes','analytics'],
    ['tiktok','tiktokRoutes','tiktok'], ['team','teamRoutes','team'], ['admin','adminRoutes','admin'],
  ]) app.register((await import(`../src/api/routes/${name}.js`))[exported], { prefix: `/api/${prefix}` });
  await app.ready();
  const req = (method, path, user = 'a', payload) => app.inject({ method, url: path, headers: { 'x-test-user': user }, payload });
  const get = async (path, user) => { const response = await req('GET',path,user); assert.equal(response.statusCode,200,response.body); return response.json(); };
  const ids = rows => rows.map(r => r.id).sort();
  const denied = async (method,path,payload,user = 'a') => { const response = await req(method,path,user,payload); assert.ok([403,404].includes(response.statusCode), response.body); };

  await t.test('lists, shared folders, direct products and reviews isolate buyers and teams', async () => {
    assert.deepEqual(ids((await get('/api/products')).items),['pa','pa2']);
    assert.deepEqual(ids((await get('/api/products','b')).items),['pb']);
    assert.deepEqual(ids((await get('/api/products','owner')).items),['pa','pa2','pb']);
    assert.deepEqual(ids((await get('/api/products','lead')).items),['pa','pa2','pb']);
    assert.deepEqual(ids((await get('/api/products','other')).items),['po']);
    for (const id of ['pb','po']) {
      await denied('GET',`/api/products/${id}`);
      await denied('GET',`/api/products/${id}/reviews`);
    }
    assert.deepEqual(ids(await get('/api/products/pa/reviews')),['ra']);
    const shared = (await get('/api/folders')).find(f => f.id === 'shared');
    assert.equal(shared.product_count,0);
    assert.deepEqual(await get('/api/folders/counts'),{ total:2,unfiled:2 });
  });
  await t.test('creative filters and favorites never expose or modify another author', async () => {
    assert.deepEqual(ids(await get('/api/creatives')),['broken','ca','ca2']);
    assert.deepEqual(ids(await get('/api/creatives','b')),['cb']);
    assert.deepEqual(ids(await get('/api/creatives','lead')),['broken','ca','ca2','cb']);
    await denied('GET','/api/creatives?product_id=pb');
    await denied('GET','/api/creatives?product_id=po');
    await denied('PATCH','/api/creatives/cb/favorite',{});
    assert.equal((await req('PATCH','/api/creatives/ca/favorite','a',{})).statusCode,200);
    assert.equal((await db.findOne('creatives',{ id:'cb' })).favorite,false);
  });
  await t.test('push wizard only offers personal products, files and templates', async () => {
    const data = await get('/api/push/options');
    assert.deepEqual(ids(data.products),['pa','pa2']);
    assert.deepEqual(ids(data.creatives),['ca','ca2']);
    assert.deepEqual(ids(data.presets),['asa']);
    assert.deepEqual(ids(data.landings),['lta']);
    assert.deepEqual(ids((await get('/api/push/options','lead')).products),['pa','pa2','pb']);
  });
  await t.test('push validates authors, product relation, completed file and duplicate IDs before side effects', async () => {
    const body = { product_id:'pa',creative_ids:['cb'],cabinet_external_id:'not-used',pixel_id:'not-used',daily_budget:10,bid_amount:2 };
    for (const id of ['cb','co']) await denied('POST','/api/push',{ ...body,creative_ids:[id] });
    for (const creative_ids of [['ca2'],['broken'],['ca','ca']]) {
      const response = await req('POST','/api/push','a',{ ...body,creative_ids });
      assert.equal(response.statusCode,400,response.body);
    }
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM pushes')).rows[0].count),0);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM agent_jobs')).rows[0].count),0);
  });
  await t.test('a batch push checks every cabinet before writing and creates one push per cabinet', async () => {
    const common = { product_id:'pa',creative_ids:['ca'],countries:['FR'] };
    const cab = (ext, extra = {}) => ({ cabinet_external_id:ext,pixel_id:'px',page_external_id:'pg',daily_budget:10,bid_amount:2,...extra });
    const count = async () => Number((await db.query('SELECT COUNT(*) FROM pushes')).rows[0].count);
    const foreign = await req('POST','/api/push/batch','a',{ ...common,cabinets:[cab('act_111'),cab('act_333')] });
    assert.equal(foreign.statusCode,403,foreign.body);
    assert.match(foreign.json().message,/act_333/);
    const noBudget = await req('POST','/api/push/batch','a',{ ...common,daily_budget:50,cabinets:[cab('act_111'),cab('act_222',{ daily_budget:undefined })] });
    assert.equal(noBudget.statusCode,400,noBudget.body);
    assert.equal((await req('POST','/api/push/batch','a',{ ...common,cabinets:[cab('act_111'),cab('111')] })).statusCode,400,'same cabinet twice');
    assert.equal((await req('POST','/api/push/batch','a',{ ...common,cabinets:[] })).statusCode,400);
    assert.equal((await req('POST','/api/push','owner',{ ...common,...cab('act_999') })).statusCode,403,'unknown cabinet even for the owner');
    assert.equal(await count(),0);
    const ok = await req('POST','/api/push/batch','a',{ ...common,cabinets:[cab('act_111'),cab('act_222',{ daily_budget:15,bid_amount:3 })] });
    assert.equal(ok.statusCode,200,ok.body);
    const results = ok.json().results;
    assert.equal(results.length,2);
    assert.ok(results.every(r => r.push_id && !r.error));
    const rows = (await db.query('SELECT params,created_by FROM pushes ORDER BY params->>\'cabinet_external_id\'')).rows;
    assert.deepEqual(rows.map(r => [r.params.cabinet_external_id,r.params.daily_budget,r.params.bid_amount,r.params.run_now,r.created_by]),
      [['act_111',10,2,false,'a'],['act_222',15,3,false,'a']]);
    await new Promise(r => setTimeout(r,100));
    await db.query('DELETE FROM pushes');
  });
  await t.test('folder and preset references cannot cross a team or private author', async () => {
    for (const folder_id of ['private_b','foreign_folder']) {
      await denied('POST','/api/products/move',{ ids:['pa'],folder_id });
      await denied('POST','/api/products',{ title:'Rejected',folder_id });
      await denied('POST','/api/folders',{ name:'Rejected',parent_id:folder_id });
    }
    await denied('PATCH','/api/products/pa',{ bundle_preset_id:'bpb' });
    await denied('POST','/api/products',{ title:'Rejected',bundle_preset_id:'bpo' });
    assert.equal((await req('POST','/api/products/move','a',{ ids:['pa'],folder_id:'shared' })).statusCode,200);
    assert.equal((await get('/api/folders')).find(f => f.id==='shared').product_count,1);
  });
  await t.test('presets and templates hide peers, and foreign writes are denied', async () => {
    for (const [path,ownId,foreignId] of [['presets/bundles','bpa','bpb'],['presets/creatives','cpa','cpb'],['ad-settings','asa','asb'],['ad-presets','apa','apb'],['landings/templates','lta','ltb']]) {
      assert.deepEqual(ids(await get(`/api/${path}`)),[ownId]);
      await denied('DELETE',`/api/${path}/${foreignId}`);
    }
    await denied('PATCH','/api/ad-settings/asb',{ name:'Rejected' });
    await denied('PATCH','/api/ad-presets/apb',{ name:'Rejected' });
    await denied('POST','/api/ad-settings',{ name:'Rejected',product_ids:['pb'] });
    assert.equal((await db.findOne('ad_settings',{ id:'asb' })).name,'B');
  });
  await t.test('landing compilation and previews deny foreign products before rendering or uploading', async () => {
    for (const path of ['compile-landing','upload-landing-keitaro']) {
      await denied('POST',`/api/push/${path}`,{ template_id:'lta',product_id:'pb' });
      await denied('POST',`/api/push/${path}`,{ template_id:'ltb',product_id:'pa' });
    }
    await denied('POST','/api/landings/check',{ template_id:'lta',product_id:'pb' });
    await denied('POST','/api/push/generate-texts',{ product_id:'pb' });
    const response = await req('POST','/api/push/compile-landing','a',{ template_id:'lta',product_id:'pa' });
    assert.equal(response.statusCode,200,response.body);
    assert.match(response.json().html,/A product/);
  });
  await t.test('search results and historical jobs belong to their requester', async () => {
    assert.deepEqual(ids(await get('/api/search/history')),['ja']);
    assert.deepEqual(ids(await get('/api/search/history','owner')),['ja','jb','legacy']);
    for (const id of ['jb','jo','legacy']) await denied('GET',`/api/search/${id}`);
    assert.equal((await get('/api/search/ja')).id,'ja');
    const response = await req('POST','/api/search/amazon','a',{ queries:[] });
    assert.equal(response.statusCode,200,response.body);
    const id = response.json().job_id;
    assert.equal((await db.findOne('scrape_jobs',{ id })).created_by,'a');
    for (let i=0;i<100;i++) {
      if ((await db.findOne('scrape_jobs',{ id })).status !== 'processing') break;
      await new Promise(resolve => setTimeout(resolve,10));
    }
  });
  await t.test('overview and daily totals do not leak colleague revenue', async () => {
    const data = await get('/api/analytics/overview');
    assert.equal(data.products_count,2);
    assert.equal(data.creatives_count,3);
    // Spend and revenue left /overview (they were stale); only the daily series carries money now.
    assert.equal(data.total_spend,undefined);
    assert.equal((await get('/api/analytics/overview','owner')).products_count,3);
    assert.equal((await get('/api/analytics/daily'))[0].spend,10);
  });
  await t.test('TikTok: foreign products, foreign campaigns and internal video addresses are refused', async () => {
    await denied('POST','/api/tiktok/generate-video',{ product_id:'pb' });
    await denied('POST','/api/tiktok/generate-video',{ product_id:'po' });
    const body = { product_id:'pa',tiktok_account_id:'tta',video_url:'https://example.invalid/v.mp4',ad_text:'Text',landing_page_url:'https://example.invalid/',daily_budget:20 };
    await denied('POST','/api/tiktok/push',{ ...body,product_id:'pb' });
    const status = await req('PATCH','/api/tiktok/campaigns/1700000000/status','a',{ advertiser_id:'adv1',status:'ENABLE' });
    assert.equal(status.statusCode,403,status.body);
    for (const video_url of ['http://127.0.0.1:4000/api/health','http://[::ffff:127.0.0.1]/x','http://169.254.169.254/latest']) {
      const response = await req('POST','/api/tiktok/push','a',{ ...body,video_url });
      assert.equal(response.statusCode,502,response.body);
      const row = await db.findOne('pushes',{ id:response.json().push_id });
      assert.equal(row.status,'failed');
      assert.equal(row.created_by,'a');
      assert.equal(row.params.campaign_id,undefined);
    }
  });
  await t.test('TikTok: a failed push resumes with the ids it already has instead of a new campaign', async () => {
    const body = { product_id:'pa',tiktok_account_id:'tta',video_url:'https://example.invalid/v.mp4',ad_text:'Text',landing_page_url:'https://example.invalid/',daily_budget:20 };
    const saved = { tiktok:true,tiktok_account_id:'tta',advertiser_id:'adv1',video_id:'v1',campaign_id:'c1',adgroup_id:'g1',ad_id:'ad1' };
    const failed = await db.insert('pushes',{ workspace_id:'w1',product_id:'pa',params:saved,status:'failed',created_by:'a',log:JSON.stringify([]) });
    assert.equal((await req('POST','/api/tiktok/push','b',{ ...body,product_id:'pb',resume_push_id:failed.id })).statusCode,409,'another buyer cannot resume it');
    const response = await req('POST','/api/tiktok/push','a',{ ...body,resume_push_id:failed.id });
    assert.equal(response.statusCode,200,response.body);
    assert.equal(response.json().campaign_id,'c1');
    assert.equal(response.json().push_id,failed.id);
    const row = await db.findOne('pushes',{ id:failed.id });
    assert.equal(row.status,'done');
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM pushes WHERE params->>'campaign_id'='c1'")).rows[0].count),1);
    assert.equal((await req('POST','/api/tiktok/push','a',{ ...body,resume_push_id:failed.id })).statusCode,409,'a finished push is not resumed again');
  });
  await t.test('an email differing only in case cannot be registered twice', async () => {
    const invite = await req('POST','/api/team/invite','owner',{ email:'A@Test.Invalid',name:'Copy',password:'secret1',role:'buyer' });
    assert.equal(invite.statusCode,400,invite.body);
    const created = await req('POST','/api/admin/users','owner',{ email:' New@Test.Invalid ',name:'New',password:'secret1',role:'buyer' });
    assert.equal(created.statusCode,200,created.body);
    assert.equal((await db.query("SELECT email FROM users WHERE name='New'")).rows[0].email,'new@test.invalid');
    await assert.rejects(db.query("INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES ('dup','w1','NEW@test.invalid','D','x','buyer')"));
  });
  await t.test('nobody changes their own role through the team page', async () => {
    const response = await req('PATCH','/api/team/members/owner','owner',{ role:'buyer' });
    assert.equal(response.statusCode,400,response.body);
    assert.equal((await db.findOne('users',{ id:'owner' })).role,'owner');
    assert.equal((await req('PATCH','/api/team/members/a','owner',{ role:'boss' })).statusCode,400);
  });
  await t.test('deleting a user removes them in one step and keeps every row they wrote', async () => {
    const response = await req('DELETE','/api/admin/users/b','owner');
    assert.equal(response.statusCode,200,response.body);
    assert.equal(await db.findOne('users',{ id:'b' }),null);
    for (const [table,id] of [['products','pb'],['creatives','cb'],['folders','shared'],['bundle_presets','bpb'],['creative_presets','cpb'],['tiktok_accounts','tta']]) {
      assert.equal((await db.findOne(table,{ id })).created_by,null,table);
    }
  });
  assert.equal(externalCalls,0,'Access tests must not contact Keitaro, Facebook, Amazon or an AI API');
});
