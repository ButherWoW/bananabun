import { chromium } from 'playwright';
import { enqueueAgentJob, waitAgentJobDone } from '../api/routes/agent.js';
import { amazonUrl } from './engine.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same uploads root as the static server and the creative renderer (UPLOADS_DIR when set).
const IMAGES_DIR = process.env.UPLOADS_DIR ? join(resolve(process.env.UPLOADS_DIR), 'images') : join(__dirname, '..', '..', 'uploads', 'images');

// Only the shops' image CDNs over https: the URL comes from a scraped page, so nothing else is fetched.
const IMAGE_HOST = /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com|walmartimages\.com)$/i;
const refererOf = (host) => (/walmartimages\.com$/i.test(host) ? 'https://www.walmart.com/' : 'https://www.amazon.fr/');
const RASTER = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE = 15 * 1024 * 1024;

async function downloadImage(url, asin, index) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !IMAGE_HOST.test(u.hostname)) return null;
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': refererOf(u.hostname),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ext = RASTER[String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!ext || Number(res.headers.get('content-length') || 0) > MAX_IMAGE) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > MAX_IMAGE) return null; // empty/error image or too big
    await mkdir(IMAGES_DIR, { recursive: true });
    const safeAsin = String(asin || 'img').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'img';
    // Unique per download: two products (teams, marketplaces, re-scrapes) never overwrite each other's photos.
    const filename = `${safeAsin}-${index}-${nanoid(10)}.${ext}`;
    await writeFile(join(IMAGES_DIR, filename), buf);
    return `/uploads/images/${filename}`;
  } catch {
    return null;
  }
}

const AMAZON_DOMAINS = {
  fr: 'amazon.fr',
  es: 'amazon.es',
  de: 'amazon.de',
  it: 'amazon.it',
  uk: 'amazon.co.uk',
  com: 'amazon.com',
};

// Amazon shows the server a robot check, so the page is opened by the Mac agent in a normal
// AdsPower profile. A robot check there is never bypassed: the job fails and asks for a human.
export const AMAZON_MARKETS = ['fr', 'es', 'de', 'it', 'uk', 'com', 'nl', 'pl', 'be', 'se'];

// The agent's page data → our product fields, with the photos saved on our server.
export async function productFromAgentData(data, asin) {
  if (!data?.title) throw new Error('На странице Amazon не найден товар — проверьте ссылку');
  const localImages = await Promise.all((data.images || []).slice(0, 8).map((url, i) => downloadImage(url, asin, i)));
  return {
    title: data.title, price: data.price, rating: data.rating, reviews_count: data.reviews_count || 0,
    description: data.description, photo_reviews_count: data.photo_reviews_count ?? null, has_photo_reviews: !!data.has_photo_reviews,
    images: localImages.filter(Boolean),
    currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : null,
  };
}

export async function scrapeAmazonViaAgent(ws, asin, marketplace = 'fr') {
  // Same marketplace map as link parsing; an unknown marketplace fails instead of falling back to .fr.
  if (!AMAZON_MARKETS.includes(marketplace)) {
    throw new Error(`Неизвестный маркетплейс Amazon: ${marketplace}`);
  }
  const url = amazonUrl(asin, marketplace);
  const jobId = await enqueueAgentJob(ws, 'scrape_amazon', { url });
  return productFromAgentData(await waitAgentJobDone(ws, jobId), asin);
}

export async function scrapeAmazonProduct(asin, marketplace = 'fr') {
  const domain = AMAZON_DOMAINS[marketplace] || 'amazon.fr';
  const url = `https://www.${domain}/dp/${asin}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: marketplace === 'uk' ? 'en-GB' : marketplace === 'com' ? 'en-US' : `${marketplace}-${marketplace.toUpperCase()}`,
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const blocked = await page.evaluate(() =>
      !!document.querySelector('form[action*="validateCaptcha"]') || /Robot|CAPTCHA/i.test(document.title));
    if (blocked) throw new Error('Amazon показал серверу проверку на робота — страница товара не открылась');

    const data = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || null;

      // Title
      const productTitle = getText('#productTitle') || getText('h1.a-size-large');

      // Price
      let price = null;
      const priceEl = document.querySelector('.a-price .a-offscreen') ||
                      document.querySelector('#priceblock_ourprice') ||
                      document.querySelector('#priceblock_dealprice');
      if (priceEl) {
        const raw = priceEl.textContent.replace(/[^\d,.]/g, '').replace(',', '.');
        price = parseFloat(raw);
      }

      // Rating
      let rating = null;
      const ratingEl = document.querySelector('[data-hook="rating-out-of-text"]') ||
                       document.querySelector('.a-icon-alt');
      if (ratingEl) {
        const match = ratingEl.textContent.match(/(\d[,.]?\d?)/);
        if (match) rating = parseFloat(match[1].replace(',', '.'));
      }

      // Reviews count
      let reviews_count = 0;
      const reviewsEl = document.querySelector('#acrCustomerReviewText') ||
                        document.querySelector('[data-hook="total-review-count"]');
      if (reviewsEl) {
        const match = reviewsEl.textContent.replace(/\s/g, '').match(/[\d,]+/);
        if (match) reviews_count = parseInt(match[0].replace(',', ''));
      }

      // Images
      const images = [];
      // Main image
      const mainImg = document.querySelector('#landingImage') ||
                      document.querySelector('#imgBlkFront');
      if (mainImg) {
        const src = mainImg.getAttribute('data-old-hires') ||
                    mainImg.getAttribute('data-a-dynamic-image') &&
                    Object.keys(JSON.parse(mainImg.getAttribute('data-a-dynamic-image') || '{}'))[0] ||
                    mainImg.src;
        if (src) images.push(src);
      }

      // Thumbnail images
      document.querySelectorAll('#altImages .a-button-thumbnail img').forEach(img => {
        const src = img.getAttribute('data-old-hires') || img.src;
        if (src && !src.includes('placeholder') && !images.includes(src)) {
          const hiRes = src.replace(/\._.*_\./, '.');
          images.push(hiRes);
        }
      });

      // Description
      const description = getText('#productDescription p') ||
                          getText('#feature-bullets') ||
                          getText('.a-expander-content p');

      return { title: productTitle, price, rating, reviews_count, images, description };
    });
    if (!data.title) throw new Error('На странице Amazon не найден товар — проверь ссылку или ASIN');

    // Count photo reviews
    let photo_reviews_count = 0;
    try {
      const reviewUrl = `https://www.${domain}/product-reviews/${asin}?filterByStar=all_stars&mediaType=media_reviews_only`;
      await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const countText = await page.$eval('.a-section span.a-size-base', el => el.textContent).catch(() => '0');
      const match = countText.match(/[\d,]+/);
      if (match) photo_reviews_count = parseInt(match[0].replace(',', ''));
    } catch { /* ignore */ }

    // Download images locally to avoid Amazon CDN hotlink restrictions
    const localImages = await Promise.all(
      (data.images || []).slice(0, 8).map((url, i) => downloadImage(url, asin, i))
    );
    data.images = localImages.filter(Boolean);

    return { ...data, photo_reviews_count };
  } catch (err) {
    console.error(`Scrape failed for ${asin}:`, err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
