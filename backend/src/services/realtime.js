const crypto = require('crypto');
const { SSE_TICKET_TTL_MS } = require('../config');
const { publicUser, getUserById } = require('./users');
const { nowIso } = require('../utils/validation');

const eventClients = new Map();

const sseTickets = new Map();

const ssePingIntervals = new Set();

function issueSseTicket(userId) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  sseTickets.set(ticket, {
    userId,
    expiresAt: Date.now() + SSE_TICKET_TTL_MS
  });
  if (sseTickets.size > 3000) {
    const now = Date.now();
    for (const [key, entry] of sseTickets.entries()) {
      if ((entry.expiresAt || 0) <= now) sseTickets.delete(key);
    }
  }
  return ticket;
}

async function consumeSseTicket(ticket) {
  const raw = String(ticket || '').trim();
  if (!raw) return null;
  const entry = sseTickets.get(raw);
  sseTickets.delete(raw);
  if (!entry) return null;
  if ((entry.expiresAt || 0) < Date.now()) return null;
  return getUserById(entry.userId);
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify({ ...payload, sentAt: nowIso() })}\n\n`);
}

async function emitRealtime(eventName, payload, predicate = () => true) {
  for (const [clientId, client] of eventClients.entries()) {
    try {
      if (await predicate(client)) writeSse(client.res, eventName, payload);
    } catch {
      eventClients.delete(clientId);
    }
  }
}

async function shouldReceiveRideEvent(client, ride) {
  if (!ride) return false;
  if (client.role === 'admin') return true;
  if (client.userId === ride.passengerId) return true;
  if (ride.driverId && client.userId === ride.driverId) return true;
  if (client.role === 'driver' && ride.status === 'pending') {
    const driver = await getUserById(client.userId);
    return Boolean(driver && driver.status === 'approved' && driver.online);
  }
  return false;
}

async function emitRideEvent(type, ride, extra = {}) {
  await emitRealtime('ride-update', {
    type,
    ride,
    ...extra
  }, client => shouldReceiveRideEvent(client, ride));
}

async function emitDriverEvent(type, driver, extra = {}) {
  await emitRealtime('driver-update', {
    type,
    driver: await publicUser(driver),
    ...extra
  }, client => client.role === 'admin' || client.userId === driver.id);
}

async function emitTariffEvent(rules) {
  await emitRealtime('tariff-update', {
    type: 'tariff-updated',
    tariffRules: rules
  });
}

function closeAllSseClients(reason = 'server-shutdown') {
  for (const interval of ssePingIntervals) {
    clearInterval(interval);
  }
  ssePingIntervals.clear();

  for (const [clientId, client] of eventClients.entries()) {
    try {
      writeSse(client.res, 'shutdown', { ok: false, reason, message: 'Servidor em desligamento.' });
      client.res.end();
    } catch {
      // Ignora erro de socket ja fechado.
    }
    eventClients.delete(clientId);
  }
  sseTickets.clear();
}

module.exports = {
  eventClients,
  ssePingIntervals,
  issueSseTicket,
  consumeSseTicket,
  writeSse,
  emitRealtime,
  emitRideEvent,
  emitDriverEvent,
  emitTariffEvent,
  closeAllSseClients
};
