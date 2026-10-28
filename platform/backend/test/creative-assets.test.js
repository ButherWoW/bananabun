import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,mkdir,rm,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localImageData,rasterType } from '../src/services/creative-assets.js';
import { buildCreativeHtml } from '../src/services/creative-generator.js';
import { creativePlan } from '../src/services/creative-plan.js';

test('creative asset paths stay inside uploads and do not fetch remote images',async()=>{
  const root=await mkdtemp(join(tmpdir(),'creative-assets-'));
  const previous=process.env.UPLOADS_DIR;process.env.UPLOADS_DIR=root;
  const fetchSaved=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('Remote images forbidden');};
  try {
    await mkdir(join(root,'logos'));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=','base64');
    await writeFile(join(root,'logos','own.png'),png);
    assert.match(await localImageData('/uploads/logos/own.png'),/^data:image\/png;base64,/);
    for (const url of ['https://images.example/test.png','http://127.0.0.1/private','/uploads/../../private.png','/uploads/missing.png']) await assert.rejects(localImageData(url));
    await symlink('/etc/hosts',join(root,'escape.png'));
    await assert.rejects(localImageData('/uploads/escape.png'),/путь/);
    assert.throws(()=>rasterType(Buffer.from('<svg onload="alert(1)"></svg>')));
    assert.throws(()=>rasterType(Buffer.alloc(13*1024*1024)));
    assert.equal(calls,0);
  } finally {
    globalThis.fetch=fetchSaved;
    if(previous===undefined)delete process.env.UPLOADS_DIR;else process.env.UPLOADS_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
});

test('caption, product title and features stay literal text; logo is rendered without invented claims',()=>{
  const html=buildCreativeHtml('clean',{title:'<script>alert(1)</script>',headline:'A < B & C',features:['<img src=x onerror=alert(1)>'],lang:'en',currency:'€',imageUrl:'data:image/png;base64,example',logoUrl:'data:image/png;base64,logo'});
  assert.match(html,/A &lt; B &amp; C/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/class="brand-logo"/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('Fast shipping'));
  assert.ok(!html.includes('class="label-sale"'));
});
test('caption validation and style selection reflect the actual controls',()=>{
  assert.equal(creativePlan({headline:' Hello '}).headline,'Hello');
  assert.equal(creativePlan({idea:'Old saved text'}).headline,'Old saved text');
  assert.throws(()=>creativePlan({headline:'x'.repeat(201)}));
  assert.throws(()=>creativePlan({features:'not a list'}));
  assert.throws(()=>creativePlan({landing_price:'not a price'}));
  assert.deepEqual(creativePlan({count:3,diversify:false}).styles,['clean','clean','clean']);
  assert.deepEqual(creativePlan({count:3,diversify:true}).styles,['clean','dark','gradient']);
});
