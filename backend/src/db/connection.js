const { openPool, closePool } = require('./pg');
const { DATABASE_URL } = require('../config');
const { migrate } = require('./schema');
const { seed } = require('./seed');

let isDbClosed = false;

async function openDatabase() {
  openPool(DATABASE_URL);
  isDbClosed = false;
  await migrate();
  await seed();
}

async function closeDatabaseSafely() {
  if (isDbClosed) return;
  try {
    await closePool();
  } catch {
    // Sem acao: fechamento best effort.
  } finally {
    isDbClosed = true;
  }
}

module.exports = {
  openDatabase,
  closeDatabaseSafely
};
