import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import dns from 'dns/promises';
import { compileLanding } from './landing-compiler.js';

// Opens a compiled landing in our Chromium the way a visitor would and lists what is wrong:
// broken images, script errors, unfilled template placeholders, buttons that lead off the page,
// windows over the page, bundles. Nothing is bought and nothing leaves the page: clicks are not
// made, analytics and private addresses are blocked.

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
// A landing is opened on our server: it must not reach our own services. Hosts are resolved and every
// address checked, so internal names (postgres, backend) and DNS tricks (127.0.0.1.nip.io) are refused.
function privateIp(ip) {
  const v = String(ip).toLowerCase().replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}
const hostCache = new Map();
const HOST_CACHE_TTL = 10 * 60 * 1000;
async function hostAllowed(host) {
  if (!host || !host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) return false;
  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < HOST_CACHE_TTL) return cached.ok;
  const ok = await dns.lookup(host, { all: true }).then(list => list.length > 0 && list.every(a => !privateIp(a.address))).catch(() => false);
  hostCache.set(host, { ok, at: Date.now() });
  return ok;
}
const ANALYTICS = /posthog|google-analytics|googletagmanager|facebook\.net|connect\.facebook|hotjar|clarity\.ms|yandex|doubleclick|\/api\/t(\?|$)/i;

let browser = null;
let launching = null;
async function getBrowser() {
  if (browser?.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
      .then((b) => { browser = b; return b; })
      .finally(() => { launching = null; });
  }
  return launching;
}

async function inspect(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const placeholders = [...new Set((document.body.innerHTML.match(/\{\{\s*[a-z0-9_]+\s*\}\}/gi) || []))].slice(0, 20);
    const brokenImages = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
      .map((i) => i.getAttribute('src').slice(0, 160));
    const emptyImages = [...document.images].filter((i) => !i.getAttribute('src')).length;
    // Windows over the page: fixed/sticky blocks covering most of the screen at load.
    const overlays = [...document.querySelectorAll('body *')].filter((el) => {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width * r.height > vw * vh * 0.5;
    }).map((el) => text(el)).filter(Boolean).slice(0, 5);
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ text: text(a), href: a.getAttribute('href') }));
    const hostOf = (h) => { try { return new URL(h).host; } catch { return ''; } };
    const offsite = links.filter((l) => /^https?:\/\//i.test(l.href) && hostOf(l.href) !== location.host).slice(0, 20);
    const buyWords = /buy|comprar|acheter|commander|kaufen|bestellen|acquista|ordina|kup|купить|zamów|order/i;
    const buy = [...document.querySelectorAll('a,button,[data-buy]')].filter((el) => el.hasAttribute('data-buy') || buyWords.test(text(el)))
      .map((el) => ({ text: text(el), href: el.getAttribute('href') || null, tag: el.tagName.toLowerCase() })).slice(0, 10);
    const bundles = document.querySelectorAll('[data-bundle]').length || document.querySelectorAll('[class*=bundle] label, [class*=bundle] [role=radio], [class*=bundle] input[type=radio]').length;
    const blocks = [...document.querySelectorAll('[data-block]')].map((el) => el.dataset.block);
    return { title: document.title, lang: document.documentElement.lang || null, placeholders, brokenImages, emptyImages, overlays, offsite, buy, bundles, blocks, height: document.documentElement.scrollHeight };
  });
}

export async function checkLanding({ templateId, productId, geo, ws }) {
  const { html, template, product } = await compileLanding(templateId, productId, geo, ws);
  const b = await getBrowser();
  const id = nanoid(10);
  const dir = path.join(UPLOADS_DIR, 'checks');
  await fs.mkdir(dir, { recursive: true });

  const out = { id, template: template.name, product: product.title, geo, shots: [], problems: [], checks: [], blocked: 0 };
  const errors = [];
  const failed = [];
  for (const view of [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1440, height: 900, mobile: false }]) {
    const ctx = await b.newContext({ viewport: { width: view.width, height: view.height }, isMobile: view.mobile, hasTouch: view.mobile,
      userAgent: view.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' : undefined });
    const page = await ctx.newPage();
    try {
      // WebSockets bypass page.route: switch them off before any script runs.
      await page.addInitScript(() => { try { window.WebSocket = undefined; window.EventSource = undefined; } catch {} });
      await page.route('**/*', async (route) => {
        const u = route.request().url();
        if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return route.continue();
        let host = '';
        try { host = new URL(u).hostname.replace(/^\[|\]$/g, ''); } catch { return route.abort(); }
        if (!u.startsWith('https:') || ANALYTICS.test(u) || privateIp(host) || !(await hostAllowed(host))) { out.blocked++; return route.abort(); }
        return route.continue();
      });
      if (view.mobile) {
        page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
        page.on('response', (r) => { if (r.status() >= 400 && r.request().resourceType() !== 'document') failed.push(`${r.status()} ${r.url().slice(0, 160)}`); });
      }
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (view.mobile) out.page = await inspect(page);
      const file = `${id}-${view.name}.jpg`;
      await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 70, fullPage: view.mobile, clip: view.mobile ? undefined : { x: 0, y: 0, width: 1440, height: 900 } })
        .catch(() => page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 70 }));
      out.shots.push({ view: view.name, url: `/uploads/checks/${file}` });
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  const p = out.page || {};
  if (p.placeholders?.length) out.problems.push(`В тексте остались незаполненные метки шаблона: ${p.placeholders.join(', ')}`);
  if (p.brokenImages?.length) out.problems.push(`Картинки не открылись (${p.brokenImages.length}): ${p.brokenImages.slice(0, 3).join(' · ')}`);
  if (p.emptyImages) out.problems.push(`Картинок без адреса: ${p.emptyImages}`);
  if (errors.length) out.problems.push(`Ошибки скриптов (${errors.length}): ${[...new Set(errors)].slice(0, 3).join(' · ')}`);
  if (failed.length) out.problems.push(`Файлы страницы не загрузились (${failed.length}): ${failed.slice(0, 3).join(' · ')}`);
  if (p.overlays?.length) out.problems.push(`Окно поверх страницы при открытии: «${p.overlays[0]}» — проверьте, что оно закрывается и не перекрывает кнопки`);
  if (!p.buy?.length) out.problems.push('Не найдено кнопки покупки (data-buy или слова «купить» на языке страны)');

  out.checks.push(`Заголовок страницы: ${p.title || '—'}; язык разметки: ${p.lang || 'не указан'}`);
  out.checks.push(`Кнопок покупки: ${p.buy?.length || 0}${p.buy?.length ? ` (${p.buy.slice(0, 3).map((x) => `«${x.text}»${x.href ? ` → ${x.href.slice(0, 60)}` : ''}`).join(', ')})` : ''}`);
  out.checks.push(`Комплектов на странице: ${p.bundles || 0}`);
  out.checks.push(p.offsite?.length
    ? `Ссылки на внешние адреса (${p.offsite.length}) — проверьте, что это оффер или трекер: ${p.offsite.slice(0, 3).map((l) => `«${l.text || '—'}» → ${l.href.slice(0, 80)}`).join(' · ')}`
    : 'Ссылок на внешние адреса нет');
  out.checks.push(p.blocks?.length ? `Размеченные блоки для счётчика: ${p.blocks.join(', ')}` : 'Блоки не размечены data-block — счётчик узнаёт их по названиям классов');
  out.checks.push(`Высота страницы на телефоне: ${p.height || '—'} px; запросов аналитики и к внутренним адресам оборвано: ${out.blocked}`);
  delete out.page;

  // Keep a day of check screenshots.
  fs.readdir(dir).then((files) => Promise.all(files.map(async (f) => {
    const st = await fs.stat(path.join(dir, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 86400_000) await fs.unlink(path.join(dir, f)).catch(() => {});
  }))).catch(() => {});
  return out;
}
