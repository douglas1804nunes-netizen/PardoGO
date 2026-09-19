const fs = require('fs');
const path = require('path');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ENV_FILE = path.join(__dirname, '..', '..', '.env');

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Lê uma chave do .env do projeto sem alterar process.env.
// O DATABASE_URL gravado ali é o banco de produção (Supabase).
function readEnvFileValue(key, filePath = ENV_FILE) {
  try {
    const match = fs.readFileSync(filePath, 'utf8').match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    return match ? match[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
  } catch {
    return '';
  }
}

const NO_TEST_DB_MESSAGE = [
  'Defina TEST_DATABASE_URL apontando para um Postgres de testes (os testes apagam tabelas).',
  '  Coloque no .env, por exemplo: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres',
  '  Para subir o Postgres descartável (Docker): npm run test:db'
].join('\n');

// Os testes derrubam tabelas e recriam dados. Só devolve uma URL segura para isso:
// - banco local (localhost/127.0.0.1), ou
// - banco remoto informado explicitamente em TEST_DATABASE_URL e diferente do de produção.
// TEST_DATABASE_URL vem do terminal ou, se não houver, do .env. O DATABASE_URL do .env nunca é usado.
function resolveTestDatabaseUrl({
  env = process.env,
  envFileDatabaseUrl = readEnvFileValue('DATABASE_URL'),
  envFileTestDatabaseUrl = readEnvFileValue('TEST_DATABASE_URL')
} = {}) {
  const testUrl = String(env.TEST_DATABASE_URL || envFileTestDatabaseUrl || '').trim();
  const mainUrl = String(env.DATABASE_URL || '').trim();
  const url = testUrl || mainUrl;

  if (!url) throw new Error(NO_TEST_DB_MESSAGE);

  const host = hostOf(url);
  if (!host) {
    throw new Error('A URL do banco de testes é inválida; recusando rodar os testes.');
  }

  if (LOCAL_HOSTS.has(host)) return url;

  if (!testUrl) {
    throw new Error(`Recusando rodar os testes em banco remoto (${host}): os testes apagam tabelas. Defina TEST_DATABASE_URL para um banco de testes ou use um Postgres local.`);
  }
  if (testUrl === mainUrl || testUrl === String(envFileDatabaseUrl || '').trim()) {
    throw new Error(`Recusando rodar os testes: TEST_DATABASE_URL (${host}) é igual ao DATABASE_URL de produção.`);
  }
  return testUrl;
}

module.exports = { resolveTestDatabaseUrl, readEnvFileValue };
