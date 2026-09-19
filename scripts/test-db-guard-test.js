const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTestDatabaseUrl, readEnvFileValue } = require('./lib/test-db');

const PROD = 'postgresql://postgres.abc:segredo@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
const STAGING = 'postgresql://postgres.xyz:outro@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
const LOCAL = 'postgresql://postgres:postgres@localhost:5432/postgres';

// Hermético: nunca lê o .env real do desenvolvedor.
const resolve = (env, envFileDatabaseUrl = '', envFileTestDatabaseUrl = '') =>
  resolveTestDatabaseUrl({ env, envFileDatabaseUrl, envFileTestDatabaseUrl });

assert.strictEqual(resolve({ DATABASE_URL: LOCAL }), LOCAL, 'banco local em DATABASE_URL deve ser aceito.');
assert.strictEqual(resolve({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' }), 'postgresql://u:p@127.0.0.1:5432/db', '127.0.0.1 deve ser aceito.');
assert.strictEqual(resolve({ TEST_DATABASE_URL: LOCAL, DATABASE_URL: PROD }), LOCAL, 'TEST_DATABASE_URL local vence o DATABASE_URL remoto.');
assert.strictEqual(resolve({ TEST_DATABASE_URL: STAGING, DATABASE_URL: PROD }, PROD), STAGING, 'banco remoto explícito e diferente do de produção deve ser aceito.');

// TEST_DATABASE_URL vindo do .env (não precisa exportar variável em cada terminal)
assert.strictEqual(resolve({}, PROD, LOCAL), LOCAL, 'TEST_DATABASE_URL local do .env deve ser usado.');
assert.strictEqual(resolve({}, PROD, STAGING), STAGING, 'TEST_DATABASE_URL remoto do .env, diferente do de produção, deve ser aceito.');
assert.strictEqual(resolve({ TEST_DATABASE_URL: LOCAL }, PROD, STAGING), LOCAL, 'a variável do terminal vence o .env.');
assert.throws(() => resolve({}, PROD, PROD), /igual ao DATABASE_URL/, 'TEST_DATABASE_URL do .env igual ao de produção deve ser recusado.');

assert.throws(() => resolve({}), /Defina TEST_DATABASE_URL/, 'sem URL deve falhar.');
assert.throws(() => resolve({}), /npm run test:db/, 'a mensagem de erro deve ensinar como subir o banco de testes.');
assert.throws(() => resolve({ DATABASE_URL: PROD }), /Recusando.*supabase\.com/, 'DATABASE_URL remoto sem TEST_DATABASE_URL deve ser recusado.');
assert.throws(() => resolve({ DATABASE_URL: PROD }, PROD), /Recusando/, 'DATABASE_URL igual ao .env de produção deve ser recusado.');
assert.throws(() => resolve({ TEST_DATABASE_URL: PROD, DATABASE_URL: PROD }), /igual ao DATABASE_URL/, 'TEST_DATABASE_URL igual ao DATABASE_URL deve ser recusado.');
assert.throws(() => resolve({ TEST_DATABASE_URL: PROD }, PROD), /igual ao DATABASE_URL/, 'TEST_DATABASE_URL igual ao .env de produção deve ser recusado.');
assert.throws(() => resolve({ DATABASE_URL: 'isto-nao-e-uma-url' }), /inválida/, 'URL inválida deve ser recusada.');

// leitura do arquivo .env (aspas, CRLF, espaços e chave ausente)
const tmp = path.join(os.tmpdir(), `pardogo-env-test-${process.pid}.env`);
fs.writeFileSync(tmp, `# comentario\r\nDATABASE_URL="${PROD}"\r\n  TEST_DATABASE_URL = ${LOCAL} \r\nOUTRA=1\r\n`);
try {
  assert.strictEqual(readEnvFileValue('DATABASE_URL', tmp), PROD, 'deve remover aspas e CRLF.');
  assert.strictEqual(readEnvFileValue('TEST_DATABASE_URL', tmp), LOCAL, 'deve tolerar espaços ao redor do =.');
  assert.strictEqual(readEnvFileValue('NAO_EXISTE', tmp), '', 'chave ausente devolve vazio.');
  assert.strictEqual(readEnvFileValue('DATABASE_URL', tmp + '.inexistente'), '', 'arquivo ausente devolve vazio.');
} finally {
  fs.rmSync(tmp, { force: true });
}

console.log('✓ proteção do banco de testes validada');
