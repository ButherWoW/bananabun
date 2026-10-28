// Optional real Chromium check: node test/standalone-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const dir = await mkdtemp(join(tmpdir(), 'bananabun-render-'));
process.env.UPLOADS_DIR = dir;
const launch = chromium.launch;
let browser;
chromium.launch = async options => (browser = await launch.call(chromium, options));
const { generateCreative } = await import('../src/services/creative-generator.js');
try {
  // Real, local fixture images; no downloaded product/brand assets.
  const fixtureBrowser = await launch.call(chromium,{headless:true});
  try {
    const page=await fixtureBrowser.newPage({viewport:{width:320,height:240}});
    await page.setContent('<body style="margin:0;background:#e7edf7;display:grid;place-items:center"><div style="margin:30px;background:#2667ab;color:white;padding:35px;border-radius:28px;font:24px Arial">Test product</div>');
    await page.screenshot({path:join(dir,'product.png')});
    await mkdir(join(dir,'logos'));
    await page.setViewportSize({width:180,height:72});
    await page.setContent('<body style="margin:0;background:#1b4c7c;color:white;display:grid;place-items:center;height:72px;font:bold 24px Arial">OUR BRAND</body>');
    await page.screenshot({path:join(dir,'logos','logo_1234567890123456.png')});
  } finally { await fixtureBrowser.close(); }
  const product={title:'Own product',source_price:29,images:['/uploads/product.png']};
  const logo_key='/uploads/logos/logo_1234567890123456.png';
  for (const [format, width, height] of [['1x1',1080,1080],['3x2',1200,800],['2x3',800,1200]]) {
    const result = await generateCreative(product, null, format, { style: 'clean', language: 'en', landing_price: 19, headline:'Make room for your next idea', logo_key });
    assert.ok(result);
    const page = await browser.newPage();
    try {
      for (const [url, w, h] of [[result.url,width,height],[result.thumbnail,400,Math.round(400*height/width)]]) {
        const data = await readFile(join(dir, url.split('/').pop()));
        const size = await page.evaluate(async base64 => {
          const img = new Image(); img.src = 'data:image/jpeg;base64,' + base64;
          await img.decode(); return [img.naturalWidth,img.naturalHeight];
        }, data.toString('base64'));
        assert.deepEqual(size,[w,h]);
      }
    } finally { await page.close(); }
    if(process.env.SAVE_CREATIVE_SAMPLE==='1' && format==='1x1'){
      const output=new URL('../../../docs/screenshots/own-creative-sample.jpg',import.meta.url);
      await mkdir(new URL('./',output),{recursive:true});
      await copyFile(join(dir,result.url.split('/').pop()),output);
    }
    console.log(`${format}: image and thumbnail dimensions passed`);
  }
  const plain=await generateCreative(product,null,'1x1',{style:'clean',language:'en'});
  const caption=await generateCreative(product,null,'1x1',{style:'clean',language:'en',headline:'Visible caption'});
  const logo=await generateCreative(product,null,'1x1',{style:'clean',language:'en',logo_key});
  const image=async result=>readFile(join(dir,result.url.split('/').pop()));
  assert.notDeepEqual(await image(plain),await image(caption),'Caption must change real output pixels');
  assert.notDeepEqual(await image(plain),await image(logo),'Logo must change real output pixels');
  await assert.rejects(generateCreative({title:'No image',images:[]},null,'1x1'),/фото/);
  console.log('Caption and logo change rendered pixels; missing photos fail instead of producing a placeholder.');
} finally {
  if (browser) await browser.close();
  chromium.launch = launch;
  await rm(dir,{ recursive:true,force:true });
}
