import test from 'node:test';
import assert from 'node:assert/strict';
import { findKey, totp } from '../lib/totp.js';

// RFC 6238 test key ("12345678901234567890"), at 59 s the 6-digit code is 287082.
const KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('RFC 6238 vector', () => {
  assert.equal(totp(KEY, 59000).code, '287082');
});

test('a labelled key whose length is not a multiple of 4 is taken whole', () => {
  for (const key of [KEY.slice(0, 26), KEY.slice(0, 31)]) {
    assert.equal(findKey({ remark: `login|pass|2FA: ${key}` }).key, key);
    assert.equal(findKey({ remark: `https://2fa.cn/${key.toLowerCase()}` }).key, key.toLowerCase());
  }
  const spaced = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY';
  assert.equal(findKey({ remark: `2fa: ${spaced}` }).key, spaced);
});
