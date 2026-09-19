const { dbGet } = require('../db/pg');
const { APP_VERSION, NODE_ENV, APP_BASE_URL, PAYMENT_METHODS, FIXED_FARE_BRL } = require('../config');
const { send } = require('../http/response');
const { stats } = require('../services/admin');
const { getLegalContent } = require('../services/legal');
const { eventClients } = require('../services/realtime');
const { getTariffRules } = require('../services/tariff');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') {
    try {
      const probe = await dbGet('SELECT 1 AS ok');
      if (!probe || Number(probe.ok) !== 1) throw new Error('probe_failed');
      return send(res, 200, {
        ok: true,
        app: 'PardoGo',
        version: APP_VERSION,
        environment: NODE_ENV,
        renderCommit: String(process.env.RENDER_GIT_COMMIT || '').trim().slice(0, 12) || null,
        renderBranch: String(process.env.RENDER_GIT_BRANCH || '').trim() || null,
        renderRepo: String(process.env.RENDER_GIT_REPO_SLUG || '').trim() || null,
        uptimeSeconds: Math.round(process.uptime()),
        baseUrl: APP_BASE_URL,
        realtimeClients: eventClients.size,
        database: 'postgresql',
        features: ['api', 'postgresql', 'secure-sessions', 'security-headers', 'rate-limit', 'production-healthcheck', 'deploy-ready', 'geolocation', 'leaflet-map', 'route-calculation', 'realtime-sse', 'ride-cancellation', 'ride-contact', 'ride-rating', 'quality-dashboard', 'support-tickets', 'safety-reports', 'driver-documents', 'legal-lgpd', 'pwa', 'capacitor-android', 'mobile-api-config', 'mobile-cors']
      });
    } catch {
      return send(res, 503, {
        ok: false,
        app: 'PardoGo',
        version: APP_VERSION,
        environment: NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
        error: 'Serviço temporariamente indisponível.'
      });
    }
  }

  if (method === 'GET' && pathname === '/api/config') {
    return send(res, 200, { ok: true, tariffRules: await getTariffRules(), fixedFare: FIXED_FARE_BRL, stats: await stats(), paymentMethods: PAYMENT_METHODS });
  }

  if (method === 'GET' && pathname === '/api/legal') {
    return send(res, 200, { ok: true, legal: getLegalContent() });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
