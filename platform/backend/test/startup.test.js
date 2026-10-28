import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hasTestDatabase,testDatabase } from './helpers/test-db.js';

test('real backend starts its worker and shuts down cleanly', { skip:!hasTestDatabase,timeout:20000 },async t=>{
  const { db }=await testDatabase(t,'backend_start');
  const directory=await mkdtemp(join(tmpdir(),'backend-start-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await db.insert('creatives',{id:'startup-job',workspace_id:'test-ws',product_id:'p',created_by:'owner',status:'pending',type:'image',format:'1x1',metadata:{source:'local',style:'clean'}});
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const child=spawn(process.execPath,['src/index.js'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),JWT_SECRET:'test-only-32-characters-secret-key',UPLOADS_DIR:directory},
    stdio:['ignore','pipe','pipe'],
  });
  let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});
  const exit=once(child,'exit');
  t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
  const waitFor=async predicate=>{for(let i=0;i<150;i++){
    assert.equal(child.exitCode,null,output);
    if(await predicate())return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }throw new Error('Backend did not become ready: '+output);};
  await waitFor(async()=>fetch(`http://127.0.0.1:${port}/health`).then(r=>r.ok).catch(()=>false));
  await waitFor(async()=>(await db.findOne('creatives',{id:'startup-job'})).status==='failed');
  assert.match((await db.findOne('creatives',{id:'startup-job'})).metadata.error,/фото/);
  if(process.env.RUN_BROWSER_TESTS==='1'){
    const bcrypt=(await import('bcryptjs')).default;
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash('test-only-password',4),'owner']);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=','base64');
    await writeFile(join(directory,'photo.png'),png);
    await db.query("UPDATE products SET images='[\"/uploads/photo.png\"]'::jsonb WHERE id='p'");
    const base=`http://127.0.0.1:${port}`;
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@test.invalid',password:'test-only-password'})});
    assert.equal(login.status,200);
    const token=(await login.json()).token;
    const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'logo.png');
    const upload=await fetch(base+'/api/creatives/upload-logo',{method:'POST',headers:{authorization:'Bearer '+token},body:form});
    assert.equal(upload.status,200);
    const logo_key=(await upload.json()).key;
    const response=await fetch(base+'/api/creatives/generate',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({product_id:'p',count:1,headline:'Real queued output',logo_key})});
    assert.equal(response.status,200);
    const record=(await response.json()).creatives[0];
    await waitFor(async()=>['done','failed'].includes((await db.findOne('creatives',{id:record.id})).status));
    const completed=await db.findOne('creatives',{id:record.id});
    assert.equal(completed.status,'done',JSON.stringify(completed.metadata));
    assert.ok((await readFile(join(directory,completed.file_url.split('/').pop()))).length>1000);
    const download=await fetch(base+completed.file_url);
    assert.equal(download.status,200,'A completed creative must actually be served at its returned URL');
    assert.match(download.headers.get('content-type'),/image\/jpeg/);
    assert.equal(completed.metadata.options.headline,'Real queued output');
    assert.equal(completed.metadata.options.logo_key,logo_key);
  }
  child.kill('SIGTERM');
  const [code,signal]=await exit;
  assert.equal(signal,null,output);assert.equal(code,0,output);
  assert.ok(!output.includes('FST_ERR_INSTANCE_ALREADY_LISTENING'),output);
});
