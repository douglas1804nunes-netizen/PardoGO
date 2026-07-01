const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'pardogo.sqlite');
const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');

if (!fs.existsSync(dbPath)) {
  console.error(`Banco não encontrado: ${dbPath}`);
  console.error('Abra o sistema uma vez ou rode npm run start para criar o banco antes do backup.');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `pardogo-${stamp}.sqlite`);
fs.copyFileSync(dbPath, target);

for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${dbPath}${suffix}`;
  if (fs.existsSync(sidecar)) {
    fs.copyFileSync(sidecar, path.join(backupDir, `pardogo-${stamp}.sqlite${suffix}`));
  }
}

console.log(`✓ Backup criado em: ${target}`);
