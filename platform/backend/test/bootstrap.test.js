import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm,readFile,stat,mkdir,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { hasTestDatabase,testDatabase } from './helpers/test-db.js';
const exec=promisify(execFile);

test('existing native bcrypt password hashes remain usable',async()=>{
  // Synthetic fixture created with bcrypt 5; no real account credential.
  const legacy='$2b$04$LeJZIK1UYbV0780ao8gPV.W6eaP5Ii4/BHxd/1AFFwl92xTW9zuy2';
  assert.equal(await bcrypt.compare('legacy-test-password',legacy),true);
  assert.equal(await bcrypt.compare('wrong-test-password',legacy),false);
});

test('private local setup creates unique secrets and refuses to overwrite settings',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bootstrap-config-'));
  try {
    await mkdir(join(root,'backend'));await mkdir(join(root,'frontend'));
    await copyFile(new URL('../../setup-local.mjs',import.meta.url),join(root,'setup-local.mjs'));
    const result=await exec(process.execPath,[join(root,'setup-local.mjs')]);
    const config=await readFile(join(root,'.env'),'utf8');
    const secret=config.match(/^JWT_SECRET=(.+)$/m)[1];
    assert.equal(secret.length,64);assert.ok(!result.stdout.includes(secret));
    assert.equal((await stat(join(root,'.env'))).mode & 0o777,0o600);
    await assert.rejects(exec(process.execPath,[join(root,'setup-local.mjs')]));
    assert.equal(await readFile(join(root,'.env'),'utf8'),config);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('fresh bootstrap, concurrent migration, rollback and seed safeguards on PostgreSQL',{skip:!hasTestDatabase},async t=>{
  const {db,databaseUrl}=await testDatabase(t,'bootstrap',{empty:true});
  const {runMigrations}=await import('../src/db/migrate.js');
  const {seedOwner}=await import('../src/db/seed.js');
  const options={connectionString:databaseUrl,log:()=>{}};
  await t.test('empty database receives its core schema and every migration',async()=>{
    await runMigrations(options);
    const names=(await db.query('SELECT name FROM migrations')).rows.map(row=>row.name);
    assert.ok(names.includes('bootstrap-schema-v1'));assert.ok(names.includes('026_fresh_install_fields.sql'));
    assert.equal((await db.query('SELECT keitaro_url,keitaro_api_key FROM workspaces')).rows.length,0);
    assert.equal((await db.query("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='creatives' AND column_name='render_token'")).rows[0].count,'1');
  });
  await t.test('two repeat migrations serialize safely and do not duplicate ledger entries',async()=>{
    const before=(await db.query('SELECT COUNT(*) FROM migrations')).rows[0].count;
    await Promise.all([runMigrations(options),runMigrations(options)]);
    assert.equal((await db.query('SELECT COUNT(*) FROM migrations')).rows[0].count,before);
  });
  await t.test('failed SQL rolls back both schema change and migration marker',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'bootstrap-migration-'));
    try {
      await writeFile(join(directory,'999_bad.sql'),'CREATE TABLE should_not_exist(id int); SELECT * FROM missing_fixture_table;');
      await assert.rejects(runMigrations({...options,migrationsDir:directory}),/999_bad.sql/);
      assert.equal((await db.query("SELECT to_regclass('should_not_exist') AS name")).rows[0].name,null);
      assert.equal((await db.query("SELECT COUNT(*) FROM migrations WHERE name='999_bad.sql'")).rows[0].count,'0');
    } finally {await rm(directory,{recursive:true,force:true});}
  });
  await t.test('seed creates one owner with a usable hash and preserves them on a repeat',async()=>{
    const credentials={connectionString:databaseUrl,email:'OWNER@test.invalid',password:'private-test-password',name:'Test owner'};
    const attempts=await Promise.allSettled([seedOwner(credentials),seedOwner(credentials)]);
    assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1,'Only one concurrent seed may create the owner');
    const first=attempts.find(row=>row.status==='fulfilled').value;
    const owner=await db.findOne('users',{id:first.userId});
    assert.equal(owner.email,'owner@test.invalid');assert.equal(owner.role,'owner');
    assert.equal(await bcrypt.compare(credentials.password,owner.password_hash),true);
    await assert.rejects(seedOwner({...credentials,password:'different-test-password'}),/уже содержит/);
    assert.equal((await db.findOne('users',{id:first.userId})).password_hash,owner.password_hash);
    assert.equal((await db.query('SELECT COUNT(*) FROM workspaces')).rows[0].count,'1');
  });
});
