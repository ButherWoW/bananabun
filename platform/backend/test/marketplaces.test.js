import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { parseProductLink, sameProduct } from '../src/services/engine.js';
import { marketplaceLink } from '../../../mac-agent/lib/marketplaces.js';
import { readMarketplaceProduct } from '../../../mac-agent/lib/marketplace-product.js';

const shops = [
  {source:'target',id:'91863920',url:'https://www.target.com/p/fixture/-/A-91863920',image:'https://target.scene7.com/is/image/Target/fixture'},
  {source:'bestbuy',id:'J3GW7QQSXX',url:'https://www.bestbuy.com/product/fixture/J3GW7QQSXX',image:'https://pisces.bbystatic.com/image2/fixture.jpg'},
  {source:'etsy',id:'1234567890',url:'https://www.etsy.com/listing/1234567890/fixture',image:'https://i.etsystatic.com/fixture.jpg'},
];

test('new marketplace links identify products consistently on server and agent',()=>{
  for(const shop of shops){
    const link=parseProductLink(shop.url+'?tracking=discarded');
    assert.equal(link.source,shop.source);assert.equal(link.asin,shop.id);
    assert.deepEqual(marketplaceLink(shop.source,link.url),{id:shop.id,url:shop.url});
    assert.throws(()=>marketplaceLink(shop.source,shop.url.replace('.com','.com.evil.example')));
    assert.equal(parseProductLink(shop.url.replace('www.','user:password@www.')).asin,undefined);
  }
  assert.equal(parseProductLink('https://www.bestbuy.com/site/fixture/1234567.p').asin,'1234567');
  assert.equal(marketplaceLink('bestbuy','https://www.bestbuy.com/site/fixture/1234567.p').id,'1234567');
  assert.equal(parseProductLink('https://www.target.com/c/kitchen').asin,undefined);
  assert.equal(parseProductLink('https://www.etsy.com/shop/fixture').asin,undefined);
  assert.equal(sameProduct('https://www.etsy.com/listing/91863920/fixture','https://www.target.com/p/fixture/-/A-91863920'),false);
});

test('new marketplace readers use actual browser DOM and refuse ambiguous facts',{skip:process.env.RUN_BROWSER_TESTS!=='1'},async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();
  let html='';await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  const read=async(shop,blocks,extra='')=>{
    html='<title>Synthetic product fixture</title><h1>Fixture</h1>'+blocks.map(data=>'<script type="application/ld+json">'+JSON.stringify(data)+'</script>').join('')+extra;
    await page.goto(shop.url);
    return page.evaluate(`(${readMarketplaceProduct.toString()})(${JSON.stringify(shop.source)},${JSON.stringify(shop.id)})`);
  };
  const product=shop=>({'@type':'Product',url:shop.url,name:'Synthetic fixture',description:'<b>Literal</b> description',image:[shop.image,'https://evil.example/x.jpg'],offers:{'@type':'Offer',price:'42.50',priceCurrency:shop.source==='etsy'?'GBP':'USD',availability:'https://schema.org/InStock'}});
  for(const shop of shops)await t.test(shop.source+' title, price, currency, safe image and unknown ratings',async()=>{
    const p=product(shop),result=await read(shop,[{'@graph':[p]}]);
    assert.equal(result.title,p.name);assert.equal(result.price,42.5);assert.equal(result.currency,p.offers.priceCurrency);
    assert.deepEqual(result.images,[shop.image]);assert.equal(result.description,'Literal description');
    assert.equal(result.reviews_count,null);assert.equal(result.rating,null);assert.equal(result.available,true);
  });
  await t.test('Etsy price range or conflicting offers require a variant',async()=>{
    const shop=shops[2],p=product(shop);p.offers={'@type':'AggregateOffer',lowPrice:'10',highPrice:'25',priceCurrency:'GBP'};
    assert.equal((await read(shop,[p])).error,'VARIANT_REQUIRED');
    p.offers=[{price:'10',priceCurrency:'GBP'},{price:'25',priceCurrency:'GBP'}];
    assert.equal((await read(shop,[p])).error,'VARIANT_REQUIRED');
  });
  await t.test('related product never substitutes the requested product',async()=>{
    const shop=shops[0],p=product(shop);p.url=shop.url.replace(shop.id,'99999999');
    assert.equal((await read(shop,[p])).error,'NO_PRODUCT_DATA');
  });
  await t.test('missing currency, malformed price and sold-out availability stay honest',async()=>{
    const shop=shops[2],p=product(shop);delete p.offers.priceCurrency;
    assert.equal((await read(shop,[p])).error,'NO_CURRENCY');
    p.offers.priceCurrency='GBP';p.offers.price='12-25';
    assert.equal((await read(shop,[p])).error,'NO_PRICE');
    p.offers.price='12';p.offers.availability='https://schema.org/OutOfStock';
    assert.equal((await read(shop,[p])).available,false);
  });
  await t.test('Target hydrated price reads only the product element',async()=>{
    const shop=shops[0];
    const result=await read(shop,[],'<div data-test="product-price">$34.99</div><div>Recommended product $9.99</div>');
    assert.equal(result.price,34.99);assert.equal(result.currency,'USD');
    assert.equal((await read(shop,[],'<div>Recommended product $9.99</div>')).error,'NO_PRODUCT_DATA');
    assert.equal((await read(shop,[],'<div data-test="product-price">$34.99 - $54.99</div>')).error,'NO_PRODUCT_DATA');
  });
  await t.test('robot check stops before reading a product',async()=>{
    assert.equal((await read(shops[0],[product(shops[0])],'<div id="px-captcha"></div>')).error,'ROBOT_CHECK');
  });
});
