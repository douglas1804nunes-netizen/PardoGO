const { dbGet, dbAll } = require('../db/pg');
const { APP_VERSION } = require('../config');
const { getAllRides } = require('./rides');
const { getSupportTickets, getRideReports } = require('./support');
const { getTariffRules } = require('./tariff');
const { publicUser, getAllUsers } = require('./users');
const { nowIso, mapAsync } = require('../utils/validation');

async function stats() {
  const [
    rules,
    totalRevenueRow,
    passengers,
    driversTotal,
    driversPending,
    driversApproved,
    driversOnline,
    ridesPending,
    ridesAccepted,
    ridesFinished,
    ridesCancelled,
    contactsLogged,
    ratingsCount,
    averageRatingRow,
    lowRatedDrivers,
    supportOpen,
    reportsOpen,
    driverDocsPending
  ] = await Promise.all([
    getTariffRules(),
    dbGet("SELECT COALESCE(SUM(fare), 0) AS total FROM rides WHERE status = 'finished'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'passenger'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'driver'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'driver' AND status = 'pending'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'driver' AND status = 'approved'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'driver' AND status = 'approved' AND online = 1"),
    dbGet("SELECT COUNT(*) AS count FROM rides WHERE status = 'pending'"),
    dbGet("SELECT COUNT(*) AS count FROM rides WHERE status = 'accepted'"),
    dbGet("SELECT COUNT(*) AS count FROM rides WHERE status = 'finished'"),
    dbGet("SELECT COUNT(*) AS count FROM rides WHERE status = 'cancelled'"),
    dbGet("SELECT COUNT(*) AS count FROM ride_contacts"),
    dbGet("SELECT COUNT(*) AS count FROM ride_ratings"),
    dbGet("SELECT COALESCE(AVG(rating), 0) AS average FROM ride_ratings"),
    dbGet("SELECT COUNT(*) AS count FROM (SELECT driver_id, AVG(rating) AS avg_rating, COUNT(*) AS qty FROM ride_ratings GROUP BY driver_id HAVING COUNT(*) >= 3 AND AVG(rating) < 3.5) sub"),
    dbGet("SELECT COUNT(*) AS count FROM support_tickets WHERE status != 'closed'"),
    dbGet("SELECT COUNT(*) AS count FROM ride_reports WHERE status != 'resolved'"),
    dbGet("SELECT COUNT(*) AS count FROM users WHERE role = 'driver' AND document_status IN ('not_sent', 'pending_review')")
  ]);
  const totalRevenue = Number(totalRevenueRow.total || 0);
  const commission = totalRevenue * ((100 - Number(rules.driverSharePercent || 80)) / 100);
  return {
    passengers: Number(passengers.count),
    driversTotal: Number(driversTotal.count),
    driversPending: Number(driversPending.count),
    driversApproved: Number(driversApproved.count),
    driversOnline: Number(driversOnline.count),
    ridesPending: Number(ridesPending.count),
    ridesAccepted: Number(ridesAccepted.count),
    ridesFinished: Number(ridesFinished.count),
    ridesCancelled: Number(ridesCancelled.count),
    contactsLogged: Number(contactsLogged.count),
    ratingsCount: Number(ratingsCount.count),
    averageRating: Number(Number(averageRatingRow.average || 0).toFixed(2)),
    lowRatedDrivers: Number(lowRatedDrivers.count),
    supportOpen: Number(supportOpen.count),
    reportsOpen: Number(reportsOpen.count),
    driverDocsPending: Number(driverDocsPending.count),
    totalRevenue: Number(totalRevenue.toFixed(2)),
    estimatedPlatformCommission: Number(commission.toFixed(2))
  };
}

async function exportData() {
  const [tariffRules, users, rides, sessions, rideContacts, rideRatings, supportTickets, rideReports, auditLogs] = await Promise.all([
    getTariffRules(),
    getAllUsers().then(list => mapAsync(list, publicUser)),
    getAllRides(),
    dbAll(`
      SELECT user_id AS "userId", created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"
      FROM sessions
      ORDER BY created_at DESC
    `),
    dbAll(`
      SELECT ride_id AS "rideId", actor_user_id AS "actorUserId", target_user_id AS "targetUserId", target_role AS "targetRole", channel, phone, message, created_at AS "createdAt"
      FROM ride_contacts
      ORDER BY created_at DESC
      LIMIT 500
    `),
    dbAll(`
      SELECT ride_id AS "rideId", passenger_id AS "passengerId", driver_id AS "driverId", rating, comment, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM ride_ratings
      ORDER BY created_at DESC
      LIMIT 500
    `),
    getSupportTickets(),
    getRideReports(),
    dbAll(`
      SELECT actor_user_id AS "actorUserId", action, entity_type AS "entityType", entity_id AS "entityId", details, created_at AS "createdAt"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 500
    `)
  ]);
  return {
    meta: {
      appName: 'PardoGo',
      version: APP_VERSION,
      exportedAt: nowIso(),
      database: 'PostgreSQL (Supabase)', maps: 'Leaflet/OpenStreetMap + OSRM fallback', realtime: 'SSE/EventSource', cancellation: 'Cancelamento com motivo', contacts: 'WhatsApp/ligação registrados', ratings: 'Avaliações de corridas e qualidade', support: 'Chamados de suporte', reports: 'Denúncias e segurança operacional', legal: 'Termos e privacidade LGPD base'
    },
    tariffRules,
    users,
    rides,
    sessions,
    rideContacts,
    rideRatings,
    supportTickets,
    rideReports,
    auditLogs
  };
}

module.exports = {
  stats,
  exportData
};
