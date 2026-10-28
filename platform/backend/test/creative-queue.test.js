import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { hasTestDatabase,testDatabase } from './helpers/test-db.js';

test('durable creative jobs on PostgreSQL', { skip:!hasTestDatabase }, async t => {
  const { db } = await testDatabase(t,'creative_queue');
  const { runCreativeJobs } = await import('../src/services/creative-jobs.js');
  const { startGeneration,creativeRoutes } = await import('../src/api/routes/creatives.js');
  const product=await db.findOne('products',{ id:'p' });
  const app=Fastify();
  app.decorate('authenticate',async req=>{ req.user={ id:'owner',ws:'test-ws',role:'owner' }; });
  app.register(creativeRoutes,{ prefix:'/creatives' });
  await app.ready(); t.after(()=>app.close());
  const fetchSaved=globalThis.fetch;
  globalThis.fetch=async()=>{ throw new Error('No external service is allowed'); };
  t.after(()=>{globalThis.fetch=fetchSaved;});
  const queue=async (id, status='pending', extra={}) => db.insert('creatives',{
    id,workspace_id:'test-ws',created_by:'owner',product_id:'p',status,type:'image',format:'3x2',
    metadata:{ source:'local',style:'clean',language:'en',options:{ headline:'Caption',landing_price:19,features:['Real feature'] } },...extra,
  });
  const render=async (p,preset,format,options)=>({ url:`/uploads/${options.headline}.jpg`,thumbnail:'/uploads/thumb.jpg',style:options.style,language:options.language });

  await t.test('eight rows and original parameters persist before any renderer runs',async()=>{
    const answer=await startGeneration({ws:'test-ws',userId:'owner',product,body:{count:8,headline:'Saved caption',landing_price:19,format:'3x2'}});
    assert.equal(answer.total,8);
    assert.ok(answer.creatives.every(row=>row.status==='pending' && row.metadata.options.headline==='Saved caption'));
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count),8);
    await runCreativeJobs({render,limit:8});
    const rows=(await db.query('SELECT * FROM creatives')).rows;
    assert.ok(rows.every(row=>row.status==='done' && row.render_attempts===1 && row.metadata.options.landing_price===19));
    await db.query('DELETE FROM creatives');
  });
  await t.test('a crashed processing job is reclaimed after its lease; ready results are kept',async()=>{
    await queue('recover','processing',{render_token:'crashed',render_started_at:new Date(Date.now()-360000),render_attempts:1});
    await queue('ready','done',{file_url:'/uploads/keep.jpg'});
    await runCreativeJobs({render,limit:2});
    const row=await db.findOne('creatives',{id:'recover'});
    assert.equal(row.status,'done'); assert.equal(row.render_attempts,2);
    assert.equal((await db.findOne('creatives',{id:'ready'})).file_url,'/uploads/keep.jpg');
    await db.query('DELETE FROM creatives');
  });
  await t.test('two workers claim different jobs and do not render a record twice',async()=>{
    await queue('one'); await queue('two');
    let calls=0;
    const slow=async(...args)=>{calls++;await new Promise(r=>setTimeout(r,20));return render(...args);};
    await Promise.all([runCreativeJobs({render:slow,limit:1}),runCreativeJobs({render:slow,limit:1})]);
    assert.equal(calls,2);
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM creatives WHERE status='done' AND render_attempts=1")).rows[0].count),2);
    await db.query('DELETE FROM creatives');
  });
  await t.test('an obsolete worker cannot overwrite the newer lease result',async()=>{
    await queue('fenced');
    const stale=async(...args)=>{
      await db.query("UPDATE creatives SET render_token='new-worker',file_url='/uploads/new.jpg' WHERE id='fenced'");
      return render(...args);
    };
    await runCreativeJobs({render:stale,limit:1});
    const row=await db.findOne('creatives',{id:'fenced'});
    assert.equal(row.render_token,'new-worker');assert.equal(row.file_url,'/uploads/new.jpg');assert.equal(row.status,'processing');
    await db.query('DELETE FROM creatives');
  });
  await t.test('three interrupted attempts fail visibly; renderer errors also remain visible',async()=>{
    await queue('exhausted','processing',{render_started_at:new Date(Date.now()-360000),render_attempts:3});
    await queue('bad-photo');
    let calls=0;
    await runCreativeJobs({render:async()=>{calls++;throw new Error('Photo missing');},limit:2});
    assert.equal(calls,1);
    assert.equal((await db.findOne('creatives',{id:'exhausted'})).status,'failed');
    assert.equal((await db.findOne('creatives',{id:'bad-photo'})).metadata.error,'Photo missing');
  });
  await t.test('retry queues the same row, preserves options, and duplicate retries do not enqueue twice',async()=>{
    const response=await app.inject({method:'POST',url:'/creatives/bad-photo/retry',payload:{}});
    assert.equal(response.statusCode,200,response.body);
    const row=await db.findOne('creatives',{id:'bad-photo'});
    assert.equal(row.status,'pending');assert.equal(row.render_attempts,0);
    assert.equal(row.metadata.options.headline,'Caption');
    assert.equal((await app.inject({method:'POST',url:'/creatives/bad-photo/retry',payload:{}})).statusCode,400);
    await runCreativeJobs({render,limit:1});
    assert.equal((await db.findOne('creatives',{id:'bad-photo'})).status,'done');
  });
  await t.test('invalid batches do not write partial records',async()=>{
    const before=Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count);
    await assert.rejects(startGeneration({ws:'test-ws',userId:'owner',product,body:{count:8,styles:['not-supported']}}));
    await assert.rejects(startGeneration({ws:'no-workspace',userId:'owner',product,body:{count:8}}));
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count),before);
  });
  await t.test('concurrent recovery of an automatic batch inserts each slot only once',async()=>{
    await db.query('DELETE FROM creatives');
    const args={ws:'test-ws',userId:'owner',product,body:{count:8},batchKey:'scrape:123'};
    const answers=await Promise.all([startGeneration(args),startGeneration(args)]);
    assert.equal(answers.reduce((n,answer)=>n+answer.total,0),8);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count),8);
    assert.equal((await startGeneration(args)).total,0,'A replay after a crash must not create more rows');
    await startGeneration({...args,batchKey:undefined,body:{count:1,auto_batch_key:'scrape:123'}});
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM creatives')).rows[0].count),9,'Manual requests cannot provide an internal dedupe key');
  });
});
