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

test('key found as a field of an AdsPower account line, not in the password or token', () => {
  const line = `100000000000001|pw9xyz|someone@outlook.com|Pa55word@|x@inbox.com|Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0 Safari/537.36|EAABsbCSabcDEFghiJKLMNOPQRSTUVWXYZ234567abcZDZD|100000000000001|${KEY}|1 авто: https://fex.net/ru/s/abc`;
  assert.deepEqual(findKey({ remark: line }), { key: KEY, source: 'заметка профиля (строка аккаунта)' });
  assert.equal(findKey({ remark: '100000000000001|Pa55word@|EAABsbCSabcDEFghiJKLMNOPQRSTUVWXYZ' }), null);
  assert.equal(findKey({ remark: `login|pass|2FA: ${KEY.slice(0, 26)}` }).source, 'заметка профиля (подписан как 2FA)');
});
