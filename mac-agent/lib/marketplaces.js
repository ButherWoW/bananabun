import { connect } from './cdp.js';
import { sleep } from './common.js';
import { scrapeProfilePort } from './amazon.js';
import { readMarketplaceProduct } from './marketplace-product.js';

export function marketplaceLink(source, value) {
  const rules = {
    target: [/^(www\.)?target\.com$/, /^\/p\/.*\/A-(\d{5,15})\/?$/],
    bestbuy: [/^(www\.)?bestbuy\.com$/, /^\/(?:site\/(?:[^/]+\/)?|product\/[^/]+\/)([A-Za-z0-9]{5,20})(?:\.p)?\/?$/],
    etsy: [/^(www\.)?etsy\.com$/, /^\/(?:[a-z]{2}\/)?listing\/(\d{5,20})(?:\/[^/]+)?\/?$/],
  };
  const u = new URL(value), rule = rules[source];
  const id = rule?.[0].test(u.hostname) && u.pathname.match(rule[1])?.[1];
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !id) throw new Error('Нужна прямая ссылка на товар ' + source);
  return { id, url: u.origin + u.pathname };
}

const REASONS = {
  ROBOT_CHECK: 'Магазин показал проверку на робота. Откройте профиль скрапа и пройдите её вручную, затем повторите.',
  PRODUCT_REDIRECT: 'Магазин перенаправил на другую страницу; данные другого товара не сохранены.',
  AMBIGUOUS_PRODUCT: 'На странице несколько товаров или вариантов. Нужна ссылка на конкретный вариант.',
  VARIANT_REQUIRED: 'Магазин показал диапазон цен или разные варианты. Выберите конкретный вариант в магазине.',
  NO_PRODUCT_DATA: 'Магазин не отдал структурированные данные товара. Данные не подставлялись.',
  NO_PRICE: 'Магазин не показал точную цену товара.',
  NO_CURRENCY: 'Магазин не указал валюту цены.',
  NO_TITLE: 'Магазин не указал название товара.',
};

export async function scrapeMarketplace(source, url) {
  const link = marketplaceLink(source, url);
  const port = await scrapeProfilePort();
  let tab, cdp;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(link.url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error('Не удалось открыть вкладку скрапа');
    tab = await response.json(); cdp = await connect(tab.webSocketDebuggerUrl);
    const expression = `(${readMarketplaceProduct.toString()})(${JSON.stringify(source)},${JSON.stringify(link.id)})`;
    let result;
    for (let n = 0; n < 60; n++) {
      await sleep(1000);
      const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, 10000).catch(() => null);
      result = response?.result?.value;
      if (result?.title) return result;
      if (['ROBOT_CHECK', 'VARIANT_REQUIRED', 'AMBIGUOUS_PRODUCT'].includes(result?.error)) break;
    }
    throw new Error(`${source}: ${REASONS[result?.error] || 'Страница не загрузилась за 60 секунд; проверьте профиль скрапа.'}`);
  } finally {
    cdp?.close();
    if (tab?.id) await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  }
}
