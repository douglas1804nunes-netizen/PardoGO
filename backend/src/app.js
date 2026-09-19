const http = require('http');
const { openDatabase, closeDatabaseSafely } = require('./db/connection');
const { send } = require('./http/response');
const { handleApi } = require('./http/router');
const { securityHeaders, isRateLimited, shouldRedirectHttps, shouldRedirectCanonical, canonicalRedirectLocation } = require('./http/security');
const { serveStatic } = require('./http/static');
const { closeAllSseClients } = require('./services/realtime');
const { validateProductionConfig } = require('./services/system');

let isShuttingDown = false;

function installGracefulShutdown(server) {
  const shutdown = signal => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Recebido ${signal}. Iniciando graceful shutdown...`);

    closeAllSseClients(signal);

    const hardStop = setTimeout(async () => {
      await closeDatabaseSafely();
      process.exit(1);
    }, 15000);
    hardStop.unref();

    server.close(async () => {
      clearTimeout(hardStop);
      await closeDatabaseSafely();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function createServer() {
  validateProductionConfig();
  await openDatabase();
  return http.createServer(async (req, res) => {
    res.req = req;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (isShuttingDown) {
      return send(res, 503, { ok: false, error: 'Servidor em desligamento. Tente novamente em instantes.' });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders({}, req));
      return res.end();
    }
    if (shouldRedirectCanonical(req)) {
      res.writeHead(308, securityHeaders({ Location: canonicalRedirectLocation(req) }, req));
      return res.end();
    }
    if (shouldRedirectHttps(req)) {
      res.writeHead(308, securityHeaders({ Location: `https://${req.headers.host}${req.url}` }, req));
      return res.end();
    }
    if (url.pathname.startsWith('/api/') && isRateLimited(req)) {
      return send(res, 429, { ok: false, error: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' });
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  });
}

module.exports = {
  installGracefulShutdown,
  createServer
};
