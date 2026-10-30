import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../backend/node_modules/playwright/index.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const shots=fileURLToPath(new URL('../../../docs/screenshots/',import.meta.url));
await fs.mkdir(shots,{recursive:true});
const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.html':'text/html'};
const server=createServer(async(req,res)=>{
  // The build lives under /banana/ (vite base), like behind nginx.
  const url=new URL(req.url,'http://localhost');const target=path.resolve(root,'.'+decodeURIComponent(url.pathname.replace(/^\/banana(?=\/|$)/,'')));
  if(!target.startsWith(root)){res.writeHead(403);return res.end();}
  let file=target;
  if(!path.extname(url.pathname))file=path.join(root,'index.html');
  try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);}
  catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
const errors=[];
const faRequests=[];
const productFixture={id:'product',title:'Fixture product',source:'manual',engine:'own',scrape_status:'done',images:[],specs:[],bundle_config:[],preset_creatives_error:'Preset asset missing'};
let generationPayload=null;
let generated=false;
let creativePolls=0;
let uploadFailure=false;
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  // UI fixtures only: no requests leave this temporary local web server.
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname.replace(/^\/banana(?=\/)/,'');
    if (/fa-ready|ready-images|sync-fa|import-ready|fa-query/.test(p)) faRequests.push(p);
    const user={id:'test',name:'Test owner',email:'test@example.invalid',role:'owner'};
    let data=[];
    if(p==='/api/auth/me')data={user,workspace:{id:'ws_test',name:'Test workspace'}};
    else if(p==='/api/auth/login')data={user,token:'test-only-token'};
    else if(p==='/api/folders/counts')data={total:0,unfiled:0};
    else if(p==='/api/products')data={items:[productFixture],total:1,page:1,limit:24};
    else if(p==='/api/products/product')data=productFixture;
    else if(p==='/api/presets/creatives')data=[{id:'saved',name:'Saved logo preset',template:{headline:'Saved caption',logo_key:'/uploads/logos/logo_1234567890123456.png',count:1,language:'en',format:'1x1'}}];
    else if(p==='/api/creatives/generate'){
      generationPayload=route.request().postDataJSON();generated=true;
      data={creatives:[],total:1,source:'local'};
    }
    else if(p==='/api/creatives/upload-logo'){
      if(uploadFailure)return route.fulfill({status:400,json:{error:'Test upload failure'}});
      data={key:'/uploads/logos/logo_1234567890123456.png'};
    }
    else if(p==='/api/creatives' && generated){
      creativePolls++;
      data=[{id:'creative',product_id:'product',created_at:new Date().toISOString(),status:creativePolls<2?'pending':'done',type:'image',format:'1x1',file_url:'/uploads/fixture.jpg',metadata:{source:'local',language:'en'}}];
    }
    else if(p==='/api/agent/status')data={online:false,configured:false};
    else if(p==='/api/keitaro/settings')data={keitaro_url:'',keitaro_api_key:''};
    else if(p==='/api/push/options')data={products:[],creatives:[],cabinets:[],landings:[],domains:[],presets:[]};
    else if(p==='/api/campaigns/fb')data={campaigns:[],period:'today'};
    else if(p==='/api/keitaro/stats'||p==='/api/keitaro/stats/daily')data={rows:[]};
    else if(p==='/api/creatives/spend')data={total_usd:null,count:0};
    else if(p==='/api/creatives/source')data={fa_available:false,active:'local'};
    else if(p==='/api/analytics/overview')data={total_spend:0,total_revenue:0,products_count:0,creatives_count:0,campaigns_count:0};
    else if(p==='/api/adspower/profiles'||p==='/api/adspower/groups')data={list:[]};
    await route.fulfill({json:data});
  });
  await page.addInitScript(() => localStorage.setItem('token', 'test-only-token'));
  for (const name of ['creatives','landings']) {
    await page.goto(origin+'/'+name);
    if(name==='creatives') await page.getByText('Собственные шаблоны:',{exact:false}).waitFor();
    else await page.getByRole('button',{name:'Шаблоны',exact:true}).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('button',{name:/FA/}).count(),0);
  }
  await page.goto(origin+'/products');
  await page.getByText('Fixture product',{exact:true}).first().click();
  await page.getByText('Preset asset missing',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Открыть креативы',exact:true}).getAttribute('href'),'/banana/creatives?product_id=product');
  await page.goto(origin+'/banana/creatives?product_id=product');
  await page.locator('select').filter({has:page.locator('option[value="saved"]')}).selectOption('saved');
  assert.equal(await page.getByPlaceholder('Надпись на креативе (до 200 символов)').inputValue(),'Saved caption');
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
  await page.getByText('Готов',{exact:true}).waitFor({timeout:12000});
  assert.equal(generationPayload.headline,'Saved caption');
  assert.equal(generationPayload.logo_key,'/uploads/logos/logo_1234567890123456.png');
  assert.ok(creativePolls>=2,'Pending jobs must continue polling');
  assert.equal(await page.getByRole('button',{name:/Лендинг/}).count(),0);
  generationPayload=null;uploadFailure=true;
  await page.locator('input[type=file]').first().setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('test fixture')});
  await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();
  await page.getByText('Test upload failure',{exact:true}).waitFor();
  assert.equal(generationPayload,null,'Failed upload must not silently generate without the logo');
  assert.deepEqual(faRequests,[],'UI must not poll or import FA content');
  assert.deepEqual(errors,[]);
  console.log('UI passed: saved caption/logo, pending polling, visible upload errors; no FA requests or uncaught browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
