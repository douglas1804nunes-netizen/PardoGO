const { dbAll, dbRun } = require('../db/pg');
const { requireAuth } = require('../http/auth');
const { send, parseBody } = require('../http/response');
const { stats, exportData } = require('../services/admin');
const { audit } = require('../services/audit');
const { getLegalContent } = require('../services/legal');
const { emitDriverEvent, emitTariffEvent } = require('../services/realtime');
const { getAllRides } = require('../services/rides');
const { getSupportTickets, getRideReports } = require('../services/support');
const { systemChecklist } = require('../services/system');
const { getTariffRules, updateTariffRules } = require('../services/tariff');
const { publicUser, getUserById, getAllUsers } = require('../services/users');
const { nowIso, mapAsync } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/admin/system') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    return send(res, 200, { ok: true, system: systemChecklist() });
  }

  if (method === 'GET' && pathname === '/api/admin/dashboard') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    return send(res, 200, {
      ok: true,
      stats: await stats(),
      tariffRules: await getTariffRules(),
      users: await mapAsync(await getAllUsers(), publicUser),
      rides: await getAllRides(),
      supportTickets: await getSupportTickets(),
      rideReports: await getRideReports(),
      legal: getLegalContent(),
      database: { type: 'PostgreSQL', provider: 'Supabase' }
    });
  }

  if (method === 'GET' && pathname === '/api/admin/users') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const users = await mapAsync(await getAllUsers(), publicUser);
    const drivers = users.filter(item => item.role === 'driver');
    const passengers = users.filter(item => item.role === 'passenger');
    return send(res, 200, {
      ok: true,
      summary: {
        total: users.length,
        drivers: drivers.length,
        passengers: passengers.length,
        admins: users.filter(item => item.role === 'admin').length
      },
      drivers,
      passengers,
      users
    });
  }

  if (method === 'PATCH' && pathname === '/api/admin/tariff') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const next = { ...(await getTariffRules()) };
    ['base', 'perKm', 'perMin', 'min', 'driverSharePercent'].forEach(key => {
      if (body[key] !== undefined && body[key] !== '') next[key] = Number(body[key]);
    });
    if (next.driverSharePercent < 50 || next.driverSharePercent > 95) {
      return send(res, 400, { ok: false, error: 'Repasse do motorista precisa ficar entre 50% e 95%.' });
    }
    if ([next.base, next.perKm, next.perMin, next.min].some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      return send(res, 400, { ok: false, error: 'Tarifas precisam ser números positivos.' });
    }
    await updateTariffRules(next);
    await audit(user.id, 'admin_update_tariff', 'tariff_rules', '1', next);
    const updatedRules = await getTariffRules();
    await emitTariffEvent(updatedRules);
    return send(res, 200, { ok: true, tariffRules: updatedRules });
  }

  if (method === 'PATCH' && pathname === '/api/admin/drivers/approve-pending') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const pendingDriverIds = (await dbAll('SELECT id FROM users WHERE role = ? AND status = ?', ['driver', 'pending'])).map(item => item.id);
    const result = await dbRun('UPDATE users SET status = ?, updated_at = ? WHERE role = ? AND status = ?',
      ['approved', nowIso(), 'driver', 'pending']);
    for (const driverId of pendingDriverIds) {
      const updatedDriver = await getUserById(driverId);
      if (updatedDriver) await emitDriverEvent('admin-status', updatedDriver, { status: 'approved', bulk: true });
    }
    await audit(user.id, 'admin_approve_pending_drivers', 'user', null, { updated: result.changes });
    return send(res, 200, { ok: true, updated: result.changes });
  }

  const driverStatusMatch = pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/status$/);
  if (method === 'PATCH' && driverStatusMatch) {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const allowed = ['pending', 'approved', 'blocked'];
    if (!allowed.includes(body.status)) return send(res, 400, { ok: false, error: 'Status inválido.' });
    const driver = await getUserById(driverStatusMatch[1]);
    if (!driver || driver.role !== 'driver') return send(res, 404, { ok: false, error: 'Motorista não encontrado.' });
    await dbRun('UPDATE users SET status = ?, online = CASE WHEN ? = ? THEN 0 ELSE online END, updated_at = ? WHERE id = ?',
      [body.status, body.status, 'blocked', nowIso(), driver.id]);
    await audit(user.id, 'admin_update_driver_status', 'user', driver.id, { status: body.status });
    const updatedDriver = await getUserById(driver.id);
    await emitDriverEvent('admin-status', updatedDriver, { status: body.status });
    return send(res, 200, { ok: true, user: await publicUser(updatedDriver) });
  }

  const driverDocsMatch = pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/documents$/);
  if (method === 'PATCH' && driverDocsMatch) {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const body = await parseBody(req);
    const allowed = ['not_sent', 'pending_review', 'verified', 'rejected'];
    if (!allowed.includes(body.documentStatus)) return send(res, 400, { ok: false, error: 'Status documental inválido.' });
    const driver = await getUserById(driverDocsMatch[1]);
    if (!driver || driver.role !== 'driver') return send(res, 404, { ok: false, error: 'Motorista não encontrado.' });
    await dbRun('UPDATE users SET document_status = ?, documents_note = ?, updated_at = ? WHERE id = ?',
      [body.documentStatus, String(body.documentsNote || '').slice(0, 300), nowIso(), driver.id]);
    await audit(user.id, 'admin_update_driver_documents', 'user', driver.id, { documentStatus: body.documentStatus, documentsNote: body.documentsNote || '' });
    const updatedDriver = await getUserById(driver.id);
    await emitDriverEvent('document-status', updatedDriver, { documentStatus: body.documentStatus });
    return send(res, 200, { ok: true, user: await publicUser(updatedDriver) });
  }

  if (method === 'GET' && pathname === '/api/admin/export') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    await audit(user.id, 'admin_export_data', 'export', null, { format: 'json' });
    return send(res, 200, await exportData(), {
      'Content-Disposition': 'attachment; filename="pardogo-export-etapa11.json"'
    });
  }

  if (method === 'GET' && pathname === '/api/admin/audit') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return;
    const logs = await dbAll(`
      SELECT actor_user_id AS "actorUserId", action, entity_type AS "entityType", entity_id AS "entityId", details, created_at AS "createdAt"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return send(res, 200, { ok: true, logs });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
