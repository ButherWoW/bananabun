// Public demo (npm run build:demo → dist-demo, served under /banana/demo/): every section renders from the
// made-up fixtures, no request leaves for an API, and every change is refused with the demo's error text.
// PLAYWRIGHT_MODULE overrides where Playwright is imported from; DEMO_SHOTS is where screenshots go.
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pwPath = process.env.PLAYWRIGHT_MODULE || fileURLToPath(new URL('../../backend/node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(pwPath).href);

const DENIED = 'Хуй тебе';
const BASE = '/banana/demo/';
const root = fileURLToPath(new URL('../dist-demo/', import.meta.url));
const shots = process.env.DEMO_SHOTS || path.join(os.tmpdir(), 'bananabun-demo-shots');
await fs.mkdir(shots, { recursive: true });

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.html': 'text/html' };
const apiHits = [];
// Same rules as nginx: files of dist-demo under /banana/demo/, index.html for everything else there.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.includes('/api/')) { apiHits.push(url.pathname); res.writeHead(599); return res.end(); }
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  const target = path.resolve(root, '.' + decodeURIComponent(url.pathname.slice(BASE.length - 1)));
  if (target !== path.resolve(root) && !target.startsWith(root)) { res.writeHead(403); return res.end(); }
  let file = target;
  try { if (!(await fs.stat(file)).isFile()) throw 0; } catch { file = path.join(root, 'index.html'); }
  const data = await fs.readFile(file);
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const PAGES = ['dashboard', 'products', 'products/fld_demo_kitchen', 'products/none', 'campaigns', 'accounts', 'tiktok', 'google',
  'creatives', 'creatives?product_id=prd_demo_1', 'pushes', 'landings', 'ad-settings', 'ad-presets', 'analytics', 'search', '2fa',
  'admin', 'team', 'settings', 'adspower'];

const browser = await chromium.launch();
const problems = [];
const external = [];
try {
  for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const tag = `${viewport.width}px`;
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[demo]')) problems.push(`${tag} console ${m.type()}: ${m.text()}`); });
    page.on('request', r => { const u = new URL(r.url()); if (u.origin !== origin && !u.protocol.startsWith('data')) external.push(r.url()); });
    page.on('dialog', d => d.accept());

    // Login and registration lead straight into the panel.
    for (const p of ['', 'login', 'register']) {
      await page.goto(origin + BASE + p);
      await page.getByText('ДЕМО-РЕЖИМ', { exact: false }).waitFor();
      assert.ok(!page.url().includes('/login') && !page.url().includes('/register'), `${tag} ${p} stays on ${page.url()}`);
    }
    for (const p of PAGES) {
      await page.goto(origin + BASE + p);
      await page.getByText('ДЕМО-РЕЖИМ', { exact: false }).waitFor();
      await page.waitForTimeout(450);
      const text = await page.locator('main').innerText();
      assert.ok(text.trim().length > 80, `${tag} /${p} looks empty`);
      assert.ok(!/Загрузка/.test(text) || p === 'analytics', `${tag} /${p} still loading: ${text.slice(0, 200)}`);
      if (viewport.width === 1280 && ['dashboard', 'products', 'campaigns', 'analytics'].includes(p)) {
        await page.screenshot({ path: path.join(shots, `demo-banana-${p}.png`) });
      }
    }
    if (viewport.width === 390) {
      await page.goto(origin + BASE + 'products');
      await page.getByText('DemoHome', { exact: false }).first().waitFor();
      await page.screenshot({ path: path.join(shots, 'demo-banana-products-390.png') });
      await page.close();
      continue;
    }

    const expectDenied = async (what) => {
      await page.getByText(DENIED, { exact: true }).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error(`${what}: no «${DENIED}» on screen`); });
    };

    // New folder (sidebar).
    await page.goto(origin + BASE + 'products');
    await page.getByRole('button', { name: '+ Папка' }).first().click();
    await page.getByPlaceholder('Название папки').fill('Моя папка');
    await page.keyboard.press('Enter');
    await expectDenied('create folder');
    await page.screenshot({ path: path.join(shots, 'demo-banana-denied.png') });

    // New product.
    await page.getByRole('button', { name: 'Создать вручную' }).click();
    await page.locator('textarea').first().fill('Новый товар');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expectDenied('create product');
    await page.getByLabel('Закрыть').first().click().catch(() => {});

    // Product card: reviews come from the fixtures, adding one is refused.
    await page.goto(origin + BASE + 'products');
    await page.getByText('Lampe solaire', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Отзывы', exact: true }).click();
    await page.getByText('Camille R.').waitFor();
    await page.getByRole('button', { name: '+ Добавить' }).click();
    await page.getByPlaceholder('Очень доволен покупкой!').fill('Тест');
    await page.getByRole('button', { name: 'Добавить отзыв' }).click();
    await expectDenied('add review');

    // Campaign row: summary opens, switching it on is refused.
    await page.goto(origin + BASE + 'campaigns');
    await page.locator('tbody div[title*="Lampe solaire"]').first().click();
    await page.getByText('Кабинет:', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: '⏸' }).first().click();
    await expectDenied('pause campaign');

    // Creative generation shows the refusal inline.
    await page.goto(origin + BASE + 'creatives?product_id=prd_demo_1');
    await page.getByRole('button', { name: 'Сгенерировать', exact: true }).click();
    await expectDenied('generate creatives');

    // Push wizard opens with the made-up options; the read-only query builder answers.
    await page.goto(origin + BASE + 'campaigns');
    await page.getByRole('button', { name: '+ Залить рекламу' }).click();
    await page.getByRole('button', { name: 'Без пресета' }).click();
    await page.locator('.fixed button', { hasText: 'Mini hachoir' }).first().waitFor();
    await page.goto(origin + BASE + 'analytics');
    await page.getByRole('button', { name: '▶ Запустить' }).click();
    await page.getByText(/\d+ строк/).waitFor();

    // Settings save is refused; logout returns to the demo, not to a login form.
    await page.goto(origin + BASE + 'settings');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click();
    await expectDenied('save settings');
    await page.getByRole('button', { name: /Demo Owner/ }).click();
    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByText('ДЕМО-РЕЖИМ', { exact: false }).waitFor();
    assert.ok(page.url().startsWith(origin + BASE) && !page.url().includes('login'), `logout went to ${page.url()}`);
    await page.close();
  }
  assert.deepEqual(apiHits, [], 'demo must not call any API');
  assert.deepEqual(external, [], 'demo must not load anything from other hosts');
  assert.deepEqual(problems, []);
  console.log(`Demo passed: ${PAGES.length} sections at 1280 and 390 px, refusals visible, 0 API requests. Screenshots: ${shots}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
