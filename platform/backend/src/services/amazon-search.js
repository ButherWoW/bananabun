import { chromium } from 'playwright';

const AMAZON_DOMAINS = {
  fr: 'amazon.fr',
  es: 'amazon.es',
  de: 'amazon.de',
  it: 'amazon.it',
  uk: 'amazon.co.uk',
  com: 'amazon.com',
};

export async function searchAmazon(queries, marketplace = 'fr', minPrice = null, maxPrice = null) {
  const domain = AMAZON_DOMAINS[marketplace] || 'amazon.fr';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const seenAsins = new Set();
  const results = [];

  try {
    for (const query of queries) {
      try {
        const page = await context.newPage();
        let url = `https://www.${domain}/s?k=${encodeURIComponent(query)}`;
        if (minPrice) url += `&low-price=${minPrice}`;
        if (maxPrice) url += `&high-price=${maxPrice}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const title = await page.title();
        if (title.includes('Robot') || title.includes('CAPTCHA')) {
          await page.close();
          continue;
        }

        const items = await page.evaluate(() => {
          const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
          return Array.from(cards).slice(0, 20).map(card => {
            const asin = card.getAttribute('data-asin');
            if (!asin) return null;

            const titleEl = card.querySelector('h2 a span') || card.querySelector('.a-size-medium');
            const title = titleEl?.textContent?.trim() || null;

            const priceEl = card.querySelector('.a-price .a-offscreen');
            let price = null;
            if (priceEl) {
              const raw = priceEl.textContent.replace(/[^\d,.]/g, '').replace(',', '.');
              price = parseFloat(raw) || null;
            }

            const ratingEl = card.querySelector('.a-icon-alt');
            let rating = null;
            if (ratingEl) {
              const m = ratingEl.textContent.match(/(\d[,.]?\d?)/);
              if (m) rating = parseFloat(m[1].replace(',', '.'));
            }

            const reviewsEl = card.querySelector('.a-size-base.s-underline-text');
            let reviews = 0;
            if (reviewsEl) {
              const m = reviewsEl.textContent.replace(/\s/g, '').match(/[\d,]+/);
              if (m) reviews = parseInt(m[0].replace(',', ''));
            }

            const imgEl = card.querySelector('img.s-image');
            const image = imgEl?.src || null;

            return { asin, title, price, rating, reviews_count: reviews, image };
          }).filter(Boolean);
        });

        for (const item of items) {
          if (!seenAsins.has(item.asin)) {
            seenAsins.add(item.asin);
            results.push({ ...item, marketplace });
          }
        }

        await page.close();
      } catch (err) {
        console.error(`Search failed for query "${query}":`, err.message);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
