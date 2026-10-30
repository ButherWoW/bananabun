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
