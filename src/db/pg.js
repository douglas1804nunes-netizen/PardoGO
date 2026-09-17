const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const transactionContext = new AsyncLocalStorage();
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

function activeExecutor() {
  return transactionContext.getStore() || pool;
}

async function dbExec(sql) {
  return activeExecutor().query(sql);
}

async function dbGet(sql, params = []) {
  const result = await activeExecutor().query(toPositionalSql(sql), params);
  return result.rows[0];
}

async function dbAll(sql, params = []) {
  const result = await activeExecutor().query(toPositionalSql(sql), params);
  return result.rows;
}

async function dbRun(sql, params = []) {
  const result = await activeExecutor().query(toPositionalSql(sql), params);
  return { changes: result.rowCount, rows: result.rows };
}

async function withImmediateTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run(client, work);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Sem acao: rollback ja foi aplicado ou conexao encerrada.
    }
    throw error;
  } finally {
    client.release();
  }
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
  withImmediateTransaction,
  closePool,
  isUniqueConstraintError
};
