import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';

// Generate valid 8x8 images using sharp
const TINY_JPG = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
const TINY_PNG = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

// UPLOADS_DIR is a module-level constant in flux-generator.js, fixed at first import.
// Set env before importing so all tests share the same tmpDir.
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-test-'));
process.env.FAL_API_KEY = 'test-key';
process.env.UPLOADS_DIR = TMP_DIR;

// Write a tiny PNG logo for compositing tests
const logosDir = path.join(TMP_DIR, 'logos');
await fs.mkdir(logosDir, { recursive: true });
const LOGO_NAME = 'logo_remix1234567.jpg';
await fs.writeFile(path.join(logosDir, LOGO_NAME), TINY_PNG);

const { generateFluxCreative } = await import('../src/services/flux-generator.js');

function makeFetch(calls = []) {
  return async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : undefined });
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ images: [{ url: 'https://fal-output/result.jpg' }] }), text: async () => '' };
    }
    return { ok: true, arrayBuffer: async () => new Uint8Array(TINY_JPG).buffer };
  };
}

test.after(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  delete process.env.FAL_API_KEY;
  delete process.env.UPLOADS_DIR;
});

test('generateFluxCreative — remix endpoint used when product has photos', async () => {
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeFetch(calls);
  try {
    const product = {
      id: 'p1', title: 'Test Product', specs: [], bundle_config: '[]',
      images: JSON.stringify(['https://amazon.com/photo.jpg']),
    };
    const result = await generateFluxCreative(product, null, '1x1', { language: 'fr' }, 0);
    assert.ok(result.url, 'should return url');
    assert.equal(calls.length, 2, 'two fetch calls: fal.ai + download');
    const falCall = calls[0];
    assert.ok(falCall.url.includes('ideogram/v2/remix'), `should use remix endpoint, got ${falCall.url}`);
    assert.equal(falCall.body.image_url, 'https://amazon.com/photo.jpg', 'should pass product photo');
    assert.ok(typeof falCall.body.strength === 'number', 'should have strength');
    assert.ok(falCall.body.prompt.length > 0, 'should have prompt');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('generateFluxCreative — regular endpoint used when product has no photos', async () => {
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeFetch(calls);
  try {
    const product = { id: 'p2', title: 'No-photo Product', specs: [], bundle_config: '[]', images: '[]' };
    await generateFluxCreative(product, null, '1x1', { language: 'fr' }, 1);
    const falCall = calls[0];
    assert.ok(!falCall.url.includes('/remix'), `should NOT use remix endpoint, got ${falCall.url}`);
    assert.equal(falCall.body.image_url, undefined, 'should not pass image_url');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('generateFluxCreative — logo is composited when logoKey provided', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeFetch();
  try {
    const product = {
      id: 'p3', title: 'Logo Product', specs: [], bundle_config: '[]',
      images: JSON.stringify(['https://amazon.com/photo.jpg']),
    };
    const result = await generateFluxCreative(
      product, `/uploads/logos/${LOGO_NAME}`, '1x1', { language: 'fr' }, 2
    );
    assert.ok(result.url, 'should return url after logo compositing');
    await assert.doesNotReject(fs.access(path.join(TMP_DIR, result.url.replace('/uploads/', ''))));
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('generateFluxCreative — a local /uploads photo is sent as a data URI, {url} rows are read', async () => {
  await fs.mkdir(path.join(TMP_DIR, 'images'), { recursive: true });
  await fs.writeFile(path.join(TMP_DIR, 'images', 'local_photo.jpg'), TINY_JPG);
  const savedFetch = globalThis.fetch;
  try {
    for (const images of [['/uploads/images/local_photo.jpg'], [{ url: '/uploads/images/local_photo.jpg' }]]) {
      const calls = [];
      globalThis.fetch = makeFetch(calls);
      await generateFluxCreative({ id: `p-local-${calls.length}-${typeof images[0]}`, title: 'Local', specs: [], bundle_config: '[]', images }, null, '1x1', { language: 'fr' }, 3);
      assert.ok(calls[0].url.includes('/remix'));
      assert.match(calls[0].body.image_url, /^data:image\/jpeg;base64,/);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('generateFluxCreative — unreadable or non-https photos are not sent; a failed remix falls back', async () => {
  const savedFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = makeFetch(calls);
    await generateFluxCreative({ id: 'p-bad', title: 'Bad', specs: [], bundle_config: '[]', images: ['/uploads/../etc/passwd.jpg', 'http://127.0.0.1/x.jpg'] }, null, '1x1', { language: 'fr' }, 4);
    assert.ok(!calls[0].url.includes('/remix'), 'no usable photo means text-to-image');

    const fallback = [];
    globalThis.fetch = async (url, opts) => {
      fallback.push(String(url));
      if (fallback.length === 1) return { ok: false, status: 422, text: async () => 'bad image' };
      if (fallback.length === 2) return { ok: true, json: async () => ({ images: [{ url: 'https://fal-output/r.jpg' }] }) };
      return { ok: true, arrayBuffer: async () => new Uint8Array(TINY_JPG).buffer };
    };
    const result = await generateFluxCreative({ id: 'p-fb', title: 'Fallback', specs: [], bundle_config: '[]', images: ['https://amazon.com/a.jpg'] }, null, '1x1', { language: 'fr' }, 4);
    assert.ok(result.url);
    assert.ok(fallback[0].includes('/remix') && !fallback[1].includes('/remix'));
  } finally {
    globalThis.fetch = savedFetch;
  }
});
