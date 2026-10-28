import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = {
  query: (text, params) => pool.query(text, params),

  async findOne(table, where) {
    const keys = Object.keys(where);
    this.assertColumns(keys);
    const vals = Object.values(where);
    const cond = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE ${cond} LIMIT 1`, vals);
    return rows[0] || null;
  },

  async findMany(table, where = {}, opts = {}) {
    const keys = Object.keys(where);
    this.assertColumns(keys);
    const vals = Object.values(where);
    let sql = `SELECT * FROM ${table}`;
    if (keys.length) {
      const cond = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
      sql += ` WHERE ${cond}`;
    }
    if (opts.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
    if (opts.limit) sql += ` LIMIT ${opts.limit}`;
    if (opts.offset) sql += ` OFFSET ${opts.offset}`;
    const { rows } = await pool.query(sql, vals);
    return rows;
  },

  // Column names are interpolated into SQL: only plain identifiers are allowed.
  assertColumns(keys) {
    for (const k of keys) if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw Object.assign(new Error(`Недопустимое поле: ${String(k).slice(0, 40)}`), { statusCode: 400 });
  },

  async insert(table, data) {
    const id = data.id || `${table.slice(0, 3)}_${nanoid(20)}`;
    const row = { id, ...data, created_at: new Date() };
    const keys = Object.keys(row);
    this.assertColumns(keys);
    const vals = Object.values(row);
    const cols = keys.join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    return rows[0];
  },

  async update(table, id, data) {
    const updates = { ...data, updated_at: new Date() };
    const keys = Object.keys(updates);
    this.assertColumns(keys);
    const vals = Object.values(updates);
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE ${table} SET ${set} WHERE id = $${keys.length + 1} RETURNING *`,
      [...vals, id]
    );
    return rows[0];
  },

  async delete(table, id) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  },
};
