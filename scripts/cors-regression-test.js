const assert = require('assert');
const path = require('path');

(async function run() {
  process.env.NODE_ENV = 'production';
  process.env.APP_BASE_URL = 'https://example.com';
  process.env.CANONICAL_BASE_URL = 'https://example.com';
  process.env.DB_PATH = path.join(__dirname, '..', 'data', `pardogo-cors-${Date.now()}.sqlite`);
  process.env.ADMIN_INITIAL_PHONE = '67999281729';
  process.env.ADMIN_INITIAL_PASSWORD = ',Duarte1052';
  process.env.CORS_ORIGIN = 'https://example.com';
  process.env.FORCE_HTTPS = '1';
  process.env.TRUST_PROXY = '1';
  process.env.REQUIRE_SECURE_ENV = '1';

  const { createServer } = require('../server');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const allowedOrigins = ['https://localhost', 'https://pardogo-8yn0.onrender.com', 'https://example.com'];
    for (const origin of allowedOrigins) {
      const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
        headers: {
          Origin: origin,
          Accept: 'application/json',
          'x-forwarded-proto': 'https'
        }
      });
      const corsHeader = response.headers.get('access-control-allow-origin');
      assert.strictEqual(corsHeader, origin, `CORS deve aceitar ${origin}.`);
    }
    console.log('✓ CORS para origens local/mobile/Render passou');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
