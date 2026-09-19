const { requireAuth } = require('../http/auth');
const { send, parseBody } = require('../http/response');
const { emitRealtime } = require('../services/realtime');
const { getSupportTickets, getRideReports, createSupportTicket, createRideReport } = require('../services/support');
const { validateRequired } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/api/support/tickets') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    const body = await parseBody(req);
    const missing = validateRequired(['subject', 'category', 'message'], body);
    if (missing) return send(res, 400, { ok: false, error: missing });
    const ticket = await createSupportTicket(user, body);
    await emitRealtime('support-update', { type: 'support-created', ticket }, client => client.role === 'admin' || client.userId === user.id);
    return send(res, 201, { ok: true, ticket });
  }

  if (method === 'GET' && pathname === '/api/support/tickets') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    return send(res, 200, { ok: true, tickets: await getSupportTickets(user) });
  }

  if (method === 'POST' && pathname === '/api/reports') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    const body = await parseBody(req);
    const missing = validateRequired(['reportedRole', 'category', 'description'], body);
    if (missing) return send(res, 400, { ok: false, error: missing });
    const report = await createRideReport(user, body);
    await emitRealtime('security-update', { type: 'report-created', report }, client => client.role === 'admin' || client.userId === user.id);
    return send(res, 201, { ok: true, report });
  }

  if (method === 'GET' && pathname === '/api/reports') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    return send(res, 200, { ok: true, reports: await getRideReports(user) });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
