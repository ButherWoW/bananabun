import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const testUrl = process.env.BANANABUN_TEST_DATABASE_URL;

test('fb_session column saved correctly on check_profile result', { skip: !testUrl }, async t => {
  const url = new URL(testUrl);
  assert.ok(url.pathname.endsWith('_test'), 'Use an explicit disposable *_test database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Test database must be local');
  const schema = `fb_session_${process.pid}`;
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { pool } = await import('../src/db/client.js');
  t.after(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../src/db/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  await pool.query(`
    INSERT INTO workspaces(id, name) VALUES ('ws1', 'Test');
    INSERT INTO fb_accounts(id, workspace_id) VALUES ('acc1', 'ws1');
  `);

  const CODE_MAP = { fb_logged_out: 'logged_out', fb_checkpoint: 'checkpoint', fb_timeout: 'timeout' };

  const apply = (ok, code) => {
    const fbSession = ok ? 'ok' : (CODE_MAP[code] || 'unknown');
    return pool.query(
      `UPDATE fb_accounts SET status=$1, status_label=$2, last_checked_at=NOW(), fb_session=$5, fb_session_at=NOW() WHERE id=$3 AND workspace_id=$4`,
      [ok ? 'active' : 'error', ok ? null : 'test error', 'acc1', 'ws1', fbSession]
    );
  };

  await apply(true, null);
  let { rows: [row] } = await pool.query(`SELECT fb_session, fb_session_at, status FROM fb_accounts WHERE id='acc1'`);
  assert.equal(row.fb_session, 'ok');
  assert.ok(row.fb_session_at instanceof Date, 'fb_session_at is a timestamp');
  assert.equal(row.status, 'active');

  await apply(false, 'fb_logged_out');
  ({ rows: [row] } = await pool.query(`SELECT fb_session, status FROM fb_accounts WHERE id='acc1'`));
  assert.equal(row.fb_session, 'logged_out');
  assert.equal(row.status, 'error');

  await apply(false, 'fb_checkpoint');
  ({ rows: [row] } = await pool.query(`SELECT fb_session FROM fb_accounts WHERE id='acc1'`));
  assert.equal(row.fb_session, 'checkpoint');

  await apply(false, 'fb_timeout');
  ({ rows: [row] } = await pool.query(`SELECT fb_session FROM fb_accounts WHERE id='acc1'`));
  assert.equal(row.fb_session, 'timeout');

  await apply(false, null);
  ({ rows: [row] } = await pool.query(`SELECT fb_session FROM fb_accounts WHERE id='acc1'`));
  assert.equal(row.fb_session, 'unknown');
});