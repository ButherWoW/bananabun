import 'dotenv/config';
import { readdir,readFile } from 'node:fs/promises';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const directory=dirname(fileURLToPath(import.meta.url));
const CORE=['workspaces','users','folders','products','bundle_presets','creatives','creative_presets','scrape_jobs'];
const LOCK="hashtext(current_database()), hashtext(current_schema() || ':bananabun-migrations')";

export async function runMigrations({ connectionString=process.env.DATABASE_URL, migrationsDir=join(directory,'migrations'), schemaPath=join(directory,'schema.sql'), log=console.log }={}) {
  if(!connectionString)throw new Error('Задайте DATABASE_URL перед миграциями');
  const pool=new pg.Pool({connectionString});
  let client;
  let locked=false;
  try {
    client=await pool.connect();
    await client.query(`SELECT pg_advisory_lock(${LOCK})`);locked=true;
    await client.query('CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(255) PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT NOW())');
    const existing=[];
    for(const table of CORE){
      const {rows}=await client.query('SELECT to_regclass($1) AS name',[table]);
      if(rows[0].name)existing.push(table);
    }
    if(existing.length && existing.length!==CORE.length)throw new Error('Базовая схема заполнена частично. Нужна проверка; данные не изменены.');
    if(!existing.length){
      await client.query('BEGIN');
      try {
        await client.query(await readFile(schemaPath,'utf8'));
        await client.query("INSERT INTO migrations(name) VALUES('bootstrap-schema-v1') ON CONFLICT DO NOTHING");
        await client.query('COMMIT');log('Core schema created.');
      } catch(error){await client.query('ROLLBACK');throw error;}
    }
    const done=new Set((await client.query('SELECT name FROM migrations')).rows.map(row=>row.name));
    for(const file of (await readdir(migrationsDir)).filter(name=>name.endsWith('.sql')).sort()){
      if(done.has(file)){log('skip: '+file);continue;}
      await client.query('BEGIN');
      try {
        await client.query(await readFile(join(migrationsDir,file),'utf8'));
        await client.query('INSERT INTO migrations(name) VALUES($1)',[file]);
        await client.query('COMMIT');log('done: '+file);
      } catch(error){
        await client.query('ROLLBACK');
        throw Object.assign(new Error(`Миграция ${file} отменена (${error.code || 'SQL_ERROR'}); данные этой миграции не применены.`),{code:error.code});
      }
    }
    log('Migrations complete.');
  } finally {
    if(client){if(locked)await client.query(`SELECT pg_advisory_unlock(${LOCK})`).catch(()=>{});client.release();}
    await pool.end();
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runMigrations().catch(error=>{console.error(error.message);process.exitCode=1;});
}
