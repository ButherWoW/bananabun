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
  const url=new URL(req.url,'http://localhost');const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
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
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  // UI fixtures only: no requests leave this temporary local web server.
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if (/fa-ready|ready-images|sync-fa|import-ready|fa-query/.test(p)) faRequests.push(p);
    const user={id:'test',name:'Test owner',email:'test@example.invalid',role:'owner'};
    let data=[];
    if(p==='/api/auth/me')data={user,workspace:{id:'ws_test',name:'Test workspace'}};
    else if(p==='/api/auth/login')data={user,token:'test-only-token'};
    else if(p==='/api/folders/counts')data={total:0,unfiled:0};
    else if(p==='/api/products')data={items:[],total:0,page:1,limit:24};
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
  assert.deepEqual(faRequests,[],'UI must not poll or import FA content');
  assert.deepEqual(errors,[]);
  console.log('UI passed: own creatives and landings; no FA requests, no FA buttons, no uncaught browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
