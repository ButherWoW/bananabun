// Optional real Chromium check: node test/standalone-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  for (const [format, width, height] of [['1x1',1080,1080],['3x2',1200,800],['2x3',800,1200]]) {
    const result = await generateCreative({ title: 'Own product', source_price: 29, images: [] }, null, format, { style: 'clean', language: 'en', landing_price: 19 });
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
    console.log(`${format}: image and thumbnail dimensions passed`);
  }
} finally {
  if (browser) await browser.close();
  chromium.launch = launch;
  await rm(dir,{ recursive:true,force:true });
}
