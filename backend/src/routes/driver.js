const { dbAll, dbRun } = require('../db/pg');
const { requireAuth, requireApprovedDriver } = require('../http/auth');
const { send, parseBody } = require('../http/response');
const { audit } = require('../services/audit');
const { isWithinAllowedCity } = require('../services/geo');
const { emitRealtime, emitDriverEvent } = require('../services/realtime');
const { rowToRide } = require('../services/rides');
const { publicUser, getUserById } = require('../services/users');
const { nowIso, mapAsync } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/driver/rides') {
    const user = await requireAuth(req, res, ['driver']);
    if (!user) return;
    if (!requireApprovedDriver(user, res)) return;
    const rows = await dbAll('SELECT * FROM rides WHERE status = ? OR driver_id = ? ORDER BY created_at DESC', ['pending', user.id]);
    return send(res, 200, { ok: true, rides: await mapAsync(rows, rowToRide) });
  }

  if (method === 'PATCH' && pathname === '/api/driver/status') {
    const user = await requireAuth(req, res, ['driver']);
    if (!user) return;
    if (!requireApprovedDriver(user, res)) return;
    const body = await parseBody(req);
    const online = Boolean(body.online) ? 1 : 0;
    const updatedAt = nowIso();
    await dbRun('UPDATE users SET online = ?, updated_at = ? WHERE id = ?', [online, updatedAt, user.id]);
    await audit(user.id, 'update_driver_status', 'user', user.id, { online: Boolean(online) });
    const updatedDriver = await getUserById(user.id);
    await emitDriverEvent('status', updatedDriver, { online: Boolean(online) });
    if (online) {
      const pendingRides = await mapAsync(await dbAll('SELECT * FROM rides WHERE status = ? ORDER BY created_at DESC', ['pending']), rowToRide);
      await emitRealtime('driver-pending-rides', { type: 'driver-online', rides: pendingRides }, client => client.userId === user.id);
    }
    return send(res, 200, { ok: true, user: await publicUser(updatedDriver) });
  }

  if (method === 'PATCH' && pathname === '/api/driver/location') {
    const user = await requireAuth(req, res, ['driver']);
    if (!user) return;
    if (!requireApprovedDriver(user, res)) return;
    const body = await parseBody(req);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return send(res, 400, { ok: false, error: 'Latitude e longitude são obrigatórias.' });
    }
    if (!isWithinAllowedCity(lat, lng)) {
      return send(res, 400, { ok: false, error: 'Localizacao fora de Santa Rita do Pardo - MS.' });
    }
    const updatedAt = nowIso();
    await dbRun(`
      UPDATE users
      SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_location_updated_at = ?, updated_at = ?
      WHERE id = ?
    `, [lat, lng, Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null, updatedAt, updatedAt, user.id]);
    await audit(user.id, 'update_driver_location', 'user', user.id, { lat, lng });
    const updatedDriver = await getUserById(user.id);
    await emitDriverEvent('location', updatedDriver, { lat, lng });
    return send(res, 200, { ok: true, user: await publicUser(updatedDriver) });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
