const assert = require('assert');
const path = require('path');
const { validateEnvConfig } = require('../src/config/env');

(async function run() {
  process.env.NODE_ENV = 'production';
  process.env.APP_BASE_URL = 'https://example.com';
  process.env.CANONICAL_BASE_URL = 'https://example.com';
  process.env.DB_PATH = path.join(__dirname, '..', 'data', 'security-regression.sqlite');
  process.env.ADMIN_INITIAL_PHONE = '67999281729';
  process.env.ADMIN_INITIAL_PASSWORD = ',Duarte1052';
  process.env.CORS_ORIGIN = 'https://example.com';
  process.env.FORCE_HTTPS = '1';
  process.env.TRUST_PROXY = '1';
  process.env.REQUIRE_SECURE_ENV = '1';

  assert.doesNotThrow(() => validateEnvConfig(), 'Configuração de produção deve ser aceita com secrets obrigatórios.');

  process.env.ADMIN_INITIAL_PASSWORD = '123456';
  assert.throws(() => validateEnvConfig(), /ADMIN_INITIAL_PASSWORD/, 'Senha fraca deve falhar em produção.');
  console.log('✓ validação de ambiente em produção passou');
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
