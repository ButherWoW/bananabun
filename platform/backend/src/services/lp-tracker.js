// Visitor behaviour on our landings, without third-party analytics: a small script in the compiled
// page sends events to POST /api/t. Nothing personal is collected: a random per-tab id, the FB ids
// from the link (campaign/adset/ad), device class and page events.
//
// Blocks are taken from data-block="…" in the template; without it, from ids/classes that name
// a known block (gallery, price, specs, reviews…). Buttons: data-buy / data-bundle / data-quiz-answer,
// or by their words when the template has no marks.

// Absolute links go under the panel's base (https://nespizdili.lol/banana); old /uploads and /api keep working.
const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || 'https://nespizdili.lol').replace(/\/$/, '');

export function trackerScript({ templateId, productId, geo }) {
  const cfg = JSON.stringify({ u: `${PUBLIC_URL}/api/t`, t: String(templateId || ''), p: String(productId || ''), g: String(geo || '') })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<script>(function(){try{
var C=${cfg},q=new URLSearchParams(location.search),S=window.sessionStorage,v;
try{v=S.getItem('_bbv');if(!v){v=Math.random().toString(36).slice(2)+Date.now().toString(36);S.setItem('_bbv',v);}}catch(e){v=Math.random().toString(36).slice(2);}
var base={v:v,c:q.get('campaign_id')||'',s:q.get('adset_id')||'',a:q.get('ad_id')||'',pl:q.get('utm_placement')||'',src:q.get('utm_source')||'',t:C.t,p:C.p,g:C.g,w:innerWidth},buf=[],t0=Date.now(),seen={},last='',bought=0,deep=0;
function ev(e,b,n){if(buf.length<200)buf.push({e:e,b:b||'',n:n==null?null:n,ms:Date.now()-t0});}
function send(){if(!buf.length)return;var body=JSON.stringify({m:base,ev:buf.splice(0)});try{if(!(navigator.sendBeacon&&navigator.sendBeacon(C.u,body)))fetch(C.u,{method:'POST',body:body,keepalive:true,mode:'no-cors'});}catch(e){}}
var K=/gallery|galerie|price|prix|precio|spec|caract|review|avis|opini|rese|faq|question|description|bundle|offer|header|footer|delivery|livraison|envio|guarantee|garant/i;
function blockOf(el){for(var x=el;x&&x!==document.body;x=x.parentElement){if(x.dataset&&x.dataset.block)return x.dataset.block;var k=((x.id||'')+' '+(typeof x.className==='string'?x.className:'')).match(K);if(k&&x.tagName!=='A'&&x.tagName!=='BUTTON')return k[0].toLowerCase();}return '';}
ev('view');
var blocks=document.querySelectorAll('[data-block]');if(!blocks.length)blocks=[].filter.call(document.querySelectorAll('section,div[id],div[class]'),function(x){return K.test((x.id||'')+' '+(typeof x.className==='string'?x.className:''))&&x.offsetHeight>80;});
if(window.IntersectionObserver){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var b=blockOf(e.target);if(!b)return;last=b;if(!seen[b]){seen[b]=1;ev('seen',b);}});},{threshold:0.4});[].forEach.call(blocks,function(b){io.observe(b);});}
addEventListener('scroll',function(){var h=document.documentElement,p=(scrollY+innerHeight)/Math.max(h.scrollHeight,1)*100;[25,50,75,100].forEach(function(m){if(p>=m-1&&deep<m){deep=m;ev('depth','',m);}});},{passive:true});
var BUY=/buy|comprar|acheter|commander|kaufen|bestellen|acquista|ordina|kup|купить|zamów|order/i,clicks=0;
document.addEventListener('click',function(e){if(e.target.tagName==='INPUT'&&e.target.closest('label'))return;var x=e.target.closest?e.target.closest('a,button,[data-buy],[data-bundle],[data-quiz-answer],label,[role=button]'):null,b=blockOf(e.target);if(clicks++<60)ev('click',b);if(!x)return;
if(x.closest('[data-quiz-answer],[class*=quiz] label,[class*=quiz] button,[class*=survey] button,[class*=survey] label'))ev('quiz_answer',b,Number((x.closest('[data-step]')||{dataset:{}}).dataset.step)||null);
else if(x.hasAttribute('data-buy')||(!x.closest('[data-bundle]')&&BUY.test(x.textContent||''))){bought=1;ev('buy_click',b);send();}
else if(x.closest('[data-bundle],[class*=bundle]'))ev('bundle_select',b);},true);
var gone=0;function leave(){if(gone)return;gone=1;ev('leave',bought?'':last,Math.round((Date.now()-t0)/1000));send();}
addEventListener('pagehide',leave);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){leave();}});
setInterval(send,15000);
}catch(e){}})();</script>`;
}

// Device class from the user agent (no fingerprinting: only coarse buckets).
export function deviceOf(ua = '', width = 0) {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'Tablet';
  if (/Mobi|iPhone|Android/i.test(ua) || (width && width < 760)) return 'Mobile';
  return 'Desktop';
}

export function osOf(ua = '') {
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'other';
}

// In-app browsers of the ad platforms.
export function appOf(ua = '') {
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Messenger/i.test(ua)) return 'Messenger';
  return 'browser';
}
