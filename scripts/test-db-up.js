// Garante um Postgres descartável para os testes (container Docker "pardogo-test-db" em localhost:55432).
// Cria se não existir, inicia se estiver parado e espera aceitar conexões. Uso: npm run test:db
const { spawnSync } = require('child_process');

const NAME = 'pardogo-test-db';
const PORT = '55432';
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const info = docker('info');
if (info.error || info.status !== 0) fail('O Docker não está rodando. Abra o Docker Desktop, espere iniciar e rode de novo.');

const inspect = docker('inspect', '-f', '{{.State.Running}}', NAME);
if (inspect.status !== 0) {
  console.log(`Criando o container ${NAME} (Postgres 16, porta ${PORT})...`);
  const run = docker('run', '--name', NAME, '--restart', 'unless-stopped', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `${PORT}:5432`, '-d', 'postgres:16');
  if (run.status !== 0) fail(run.stderr.trim() || 'Não consegui criar o container.');
} else if (inspect.stdout.trim() !== 'true') {
  console.log(`Iniciando o container ${NAME}...`);
  const start = docker('start', NAME);
  if (start.status !== 0) fail(start.stderr.trim() || 'Não consegui iniciar o container.');
}

// -h 127.0.0.1 testa a conexão TCP de verdade (durante o initdb o Postgres só atende por socket local)
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = docker('exec', NAME, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').status === 0;
  if (!ready) sleep(500);
}
if (!ready) fail('O Postgres não ficou pronto a tempo. Veja: docker logs ' + NAME);

console.log(`✓ banco de testes pronto em localhost:${PORT} (defina TEST_DATABASE_URL no .env; veja o README)`);
