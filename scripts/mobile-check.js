const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'capacitor.config.json',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/mobile-config.js',
  'public/manifest.json',
  'public/icon.svg'
];

let ok = true;
for (const file of required) {
  const exists = fs.existsSync(path.join(root, file));
  console.log(`${exists ? '✓' : '✗'} ${file}`);
  if (!exists) ok = false;
}

const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
if (cap.appId !== 'br.com.pardogo.app') {
  console.error('✗ appId inesperado no capacitor.config.json');
  ok = false;
} else {
  console.log('✓ appId Android validado');
}

const mobileConfig = fs.readFileSync(path.join(root, 'public/mobile-config.js'), 'utf8');
if (!mobileConfig.includes('PARDOGO_MOBILE_CONFIG')) {
  console.error('✗ mobile-config.js sem window.PARDOGO_MOBILE_CONFIG');
  ok = false;
} else {
  console.log('✓ configuração mobile validada');
}

if (!ok) process.exit(1);
console.log('✓ checklist mobile Etapa 14 validado');
