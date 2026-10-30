import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, safeDownload } from '../src/services/safe-fetch.js';

test('private, loopback, mapped and metadata addresses are closed', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]', 'not-an-ip']) assert.ok(isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(a), a);
});

test('downloads refuse non-http schemes and private hosts before connecting', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'http://127.0.0.1:4000/', 'http://[::1]/', 'http://localhost:4000/']) {
    await assert.rejects(safeDownload(url, { timeoutMs: 2000 }), url);
  }
});

test('product photos for landings and videos refuse internal addresses and paths outside uploads', async () => {
  const { productImageBytes } = await import('../src/services/creative-assets.js');
  await assert.rejects(productImageBytes('http://127.0.0.1:4000/api/health'));
  await assert.rejects(productImageBytes('http://169.254.169.254/latest/meta-data'));
  await assert.rejects(productImageBytes('/uploads/../../etc/passwd.jpg'));
  assert.equal(await productImageBytes('file:///etc/passwd'), null);
});
