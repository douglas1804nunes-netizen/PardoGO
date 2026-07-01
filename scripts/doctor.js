const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'pardogo.sqlite');
const required = [
  'server.js',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/manifest.json',
  'package.json',
  '.env.example',
  'DEPLOY.md'
];

let failed = false;
console.log('PardoGo Doctor - checklist local');
console.log(`Node: ${process.version}`);
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('✗ Node precisa ser 22.5 ou superior por causa do node:sqlite.');
  failed = true;
} else {
  console.log('✓ Node compatível');
}

for (const item of required) {
  const exists = fs.existsSync(path.join(root, item));
  console.log(`${exists ? '✓' : '✗'} ${item}`);
  if (!exists) failed = true;
}

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  console.error(`✗ Pasta do banco não existe: ${dataDir}`);
  failed = true;
} else {
  console.log(`✓ Pasta do banco: ${dataDir}`);
}

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD === '123456')) {
  console.error('✗ Em produção, configure ADMIN_INITIAL_PASSWORD forte.');
  failed = true;
}

if (failed) process.exit(1);
console.log('✓ Checklist local aprovado');
