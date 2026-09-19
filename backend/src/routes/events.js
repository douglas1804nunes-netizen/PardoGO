const crypto = require('crypto');
const { SSE_PING_MS, SSE_TICKET_TTL_MS } = require('../config');
const { getBearerToken, requireAuth, getAuthUserFromToken } = require('../http/auth');
const { send } = require('../http/response');
const { securityHeaders } = require('../http/security');
const { eventClients, ssePingIntervals, issueSseTicket, consumeSseTicket, writeSse } = require('../services/realtime');
const { publicUser } = require('../services/users');
const { nowIso } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handleEvents(req, res, url) {
  const ticketUser = await consumeSseTicket(url.searchParams.get('ticket'));
  const token = getBearerToken(req);
  const user = ticketUser || (await getAuthUserFromToken(token));
  if (!user) return send(res, 401, { ok: false, error: 'Faça login para acompanhar em tempo real.' });
  if (user.status === 'blocked') return send(res, 403, { ok: false, error: 'Usuário bloqueado.' });

  const clientId = crypto.randomUUID();
  const client = {
    id: clientId,
    userId: user.id,
    role: user.role,
    name: user.name,
    createdAt: nowIso(),
    res
  };

  res.writeHead(200, {
    ...securityHeaders({}, req),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': PardoGo tempo real conectado\n\n');

  eventClients.set(clientId, client);
  writeSse(res, 'connected', {
    ok: true,
    clientId,
    user: await publicUser(user),
    message: 'Tempo real conectado.'
  });

  const ping = setInterval(() => {
    if (!eventClients.has(clientId)) {
      clearInterval(ping);
      ssePingIntervals.delete(ping);
      return;
    }
    try {
      writeSse(res, 'ping', { ok: true, clients: eventClients.size });
    } catch {
      eventClients.delete(clientId);
      clearInterval(ping);
      ssePingIntervals.delete(ping);
    }
  }, SSE_PING_MS);
  ssePingIntervals.add(ping);

  req.on('close', () => {
    clearInterval(ping);
    ssePingIntervals.delete(ping);
    eventClients.delete(clientId);
  });
}

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/api/events-ticket') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    const ticket = issueSseTicket(user.id);
    return send(res, 200, {
      ok: true,
      ticket,
      expiresInMs: SSE_TICKET_TTL_MS
    });
  }

  if (method === 'GET' && pathname === '/api/events') {
    return await handleEvents(req, res, url);
  }

  return NOT_HANDLED;
}

module.exports = { handle };
