import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export const hasTestDatabase = !!process.env.BANANABUN_TEST_DATABASE_URL;
export async function testDatabase(t, prefix, { empty=false }={}) {
  const url = new URL(process.env.BANANABUN_TEST_DATABASE_URL);
  assert.ok(url.pathname.endsWith('_test'), 'Use a disposable *_test database');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Only a local test database is allowed');
  const schema=`${prefix}_${process.pid}_${randomBytes(3).toString('hex')}`;
  url.searchParams.set('options',`-c search_path=${schema}`);
  process.env.DATABASE_URL=url.href;
  const { db,pool } = await import('../../src/db/client.js');
  await pool.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });
  if(empty)return {db,pool,databaseUrl:url.href};
  await pool.query(await readFile(new URL('../../src/db/schema.sql',import.meta.url),'utf8'));
  const directory=new URL('../../src/db/migrations/',import.meta.url);
  for (const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(name,directory),'utf8'));
  }
  await pool.query(`INSERT INTO workspaces(id,name) VALUES ('test-ws','Test');
    INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES ('owner','test-ws','owner@test.invalid','Owner','fixture','owner');
    INSERT INTO products(id,workspace_id,created_by,title,source_id,marketplace,engine)
      VALUES ('p','test-ws','owner','Test product','B012345678','fr','own');`);
  return { db,pool };
}
