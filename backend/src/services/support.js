const crypto = require('crypto');
const { dbAll, dbRun } = require('../db/pg');
const { audit } = require('./audit');
const { getRideById, canAccessRide } = require('./rides');
const { nowIso } = require('../utils/validation');

function rowToSupportTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    subject: row.subject,
    category: row.category,
    message: row.message,
    status: row.status,
    adminNote: row.admin_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToRideReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id || '',
    reporterUserId: row.reporter_user_id,
    reportedRole: row.reported_role,
    category: row.category,
    description: row.description,
    status: row.status,
    adminNote: row.admin_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getSupportTickets(user = null) {
  if (user && user.role !== 'admin') {
    return (await dbAll('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id])).map(rowToSupportTicket);
  }
  return (await dbAll('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 500')).map(rowToSupportTicket);
}

async function getRideReports(user = null) {
  if (user && user.role !== 'admin') {
    return (await dbAll('SELECT * FROM ride_reports WHERE reporter_user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id])).map(rowToRideReport);
  }
  return (await dbAll('SELECT * FROM ride_reports ORDER BY created_at DESC LIMIT 500')).map(rowToRideReport);
}

async function createSupportTicket(user, body) {
  const now = nowIso();
  const ticket = {
    id: crypto.randomUUID(),
    userId: user.id,
    role: user.role,
    subject: String(body.subject || '').trim().slice(0, 120),
    category: String(body.category || '').trim().slice(0, 60),
    message: String(body.message || '').trim().slice(0, 1200),
    status: 'open',
    adminNote: '',
    createdAt: now,
    updatedAt: now
  };
  await dbRun(`
    INSERT INTO support_tickets (id, user_id, role, subject, category, message, status, admin_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [ticket.id, ticket.userId, ticket.role, ticket.subject, ticket.category, ticket.message, ticket.status, ticket.adminNote, ticket.createdAt, ticket.updatedAt]);
  await audit(user.id, 'create_support_ticket', 'support_ticket', ticket.id, { category: ticket.category, subject: ticket.subject });
  return ticket;
}

async function createRideReport(user, body) {
  const now = nowIso();
  const allowedRoles = ['passenger', 'driver', 'platform'];
  const reportedRole = allowedRoles.includes(body.reportedRole) ? body.reportedRole : 'platform';
  if (body.rideId) {
    const ride = await getRideById(body.rideId);
    if (!ride || !canAccessRide(user, ride)) throw new Error('Corrida informada não encontrada para esse usuário.');
  }
  const report = {
    id: crypto.randomUUID(),
    rideId: body.rideId ? String(body.rideId) : '',
    reporterUserId: user.id,
    reportedRole,
    category: String(body.category || '').trim().slice(0, 80),
    description: String(body.description || '').trim().slice(0, 1200),
    status: 'open',
    adminNote: '',
    createdAt: now,
    updatedAt: now
  };
  await dbRun(`
    INSERT INTO ride_reports (id, ride_id, reporter_user_id, reported_role, category, description, status, admin_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [report.id, report.rideId || null, report.reporterUserId, report.reportedRole, report.category, report.description, report.status, report.adminNote, report.createdAt, report.updatedAt]);
  await audit(user.id, 'create_ride_report', 'ride_report', report.id, { category: report.category, reportedRole: report.reportedRole, rideId: report.rideId });
  return report;
}

module.exports = {
  getSupportTickets,
  getRideReports,
  createSupportTicket,
  createRideReport
};
