import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReferenceKeys } from '../src/api/routes/creatives.js';

test('references: own uploads and this product\'s photos only, at most 4', () => {
  const product = { images: JSON.stringify(['/uploads/images/A-0.jpg', { url: '/uploads/images/A-1.jpg' }, 'https://m.media-amazon.com/x.jpg']) };
  const keys = cleanReferenceKeys([
    '/uploads/images/A-0.jpg', '/uploads/images/A-1.jpg', '/uploads/images/OTHER.jpg', '/uploads/../.env',
    'https://m.media-amazon.com/x.jpg', '/uploads/references/ref_abcdefghijklmnop.png',
  ], product);
  assert.deepEqual(keys, ['/uploads/images/A-0.jpg', '/uploads/images/A-1.jpg', '/uploads/references/ref_abcdefghijklmnop.png']);
  assert.equal(cleanReferenceKeys(Array(6).fill('/uploads/images/A-0.jpg'), product).length, 4);
});
