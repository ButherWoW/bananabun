import test from 'node:test';
import assert from 'node:assert/strict';

function classifyPath(pathname) {
  if (/\/(login|loginpage)/i.test(pathname)) return 'fb_logged_out';
  if (/\/checkpoint/i.test(pathname)) return 'fb_checkpoint';
  return 'fb_timeout';
}

test('fb_logged_out for /login path', () => { assert.equal(classifyPath('/login'), 'fb_logged_out'); });
test('fb_logged_out for /loginpage path', () => { assert.equal(classifyPath('/business/loginpage'), 'fb_logged_out'); });
test('fb_checkpoint for /checkpoint path', () => { assert.equal(classifyPath('/checkpoint/'), 'fb_checkpoint'); });
test('fb_timeout for unexpected path', () => { assert.equal(classifyPath('/adsmanager/manage/campaigns'), 'fb_timeout'); });
test('fb_timeout for empty path', () => { assert.equal(classifyPath(''), 'fb_timeout'); });