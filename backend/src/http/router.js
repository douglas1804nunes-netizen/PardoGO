const { send } = require('./response');
const { NOT_HANDLED } = require('./not-handled');
const systemRoutes = require('../routes/system');
const eventsRoutes = require('../routes/events');
const authRoutes = require('../routes/auth');
const mapsRoutes = require('../routes/maps');
const ridesRoutes = require('../routes/rides');
const driverRoutes = require('../routes/driver');
const supportRoutes = require('../routes/support');
const adminRoutes = require('../routes/admin');

// Ordem de tentativa das rotas; cada módulo devolve NOT_HANDLED quando a requisição não é dele.
const routeModules = [systemRoutes, eventsRoutes, authRoutes, mapsRoutes, ridesRoutes, driverRoutes, supportRoutes, adminRoutes];

async function handleApi(req, res, url) {
  try {
    for (const routes of routeModules) {
      if ((await routes.handle(req, res, url)) !== NOT_HANDLED) return;
    }

    return send(res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return send(res, statusCode, { ok: false, error: error.message || 'Erro interno.' });
  }
}

module.exports = { handleApi };
