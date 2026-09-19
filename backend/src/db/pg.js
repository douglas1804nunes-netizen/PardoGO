const { Pool } = require('pg');

let pool = null;

function isLocalConnection(connectionString) {
  return /(^|@)(localhost|127\.0\.0\.1)([:/]|$)/i.test(String(connectionString || ''));
}

function openPool(connectionString) {
  if (pool) return pool;
  pool = new Pool({
    connectionString,
    ssl: isLocalConnection(connectionString) ? false : { rejectUnauthorized: false }
  });
  pool.on('error', error => {
    console.error(`Erro inesperado no pool Postgres: ${error.message}`);
  });
  return pool;
}

function toPositionalSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function dbExec(sql) {
  return pool.query(sql);
}

async function dbGet(sql, params = []) {
  const result = await pool.query(toPositionalSql(sql), params);
  return result.rows[0];
}

async function dbAll(sql, params = []) {
  const result = await pool.query(toPositionalSql(sql), params);
  return result.rows;
}

async function dbRun(sql, params = []) {
  const result = await pool.query(toPositionalSql(sql), params);
  return { changes: result.rowCount, rows: result.rows };
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

function isUniqueConstraintError(error) {
  return error?.code === '23505';
}

module.exports = {
  openPool,
  dbExec,
  dbGet,
  dbAll,
  dbRun,
  closePool,
  isUniqueConstraintError
};
