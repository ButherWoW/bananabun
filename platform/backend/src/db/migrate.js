import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: applied } = await pool.query('SELECT name FROM migrations ORDER BY name');
  const done = new Set(applied.map(r => r.name));

  const migrationsDir = join(__dirname, 'migrations');
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (done.has(file)) {
      console.log(`  skip: ${file}`);
      continue;
    }
    console.log(`  run:  ${file}`);
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO migrations(name) VALUES($1)', [file]);
    console.log(`  done: ${file}`);
  }

  await pool.end();
  console.log('Migrations complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
