const crypto = require('crypto');
const { dbGet, dbAll, dbRun } = require('../db/pg');
const { envConfig } = require('../config');
const { audit } = require('./audit');
const { haversineDistanceKm } = require('./geo');
const { getRideRating } = require('./ratings');
const { emitRealtime, emitRideEvent } = require('./realtime');
const { rowToUser, getUserById } = require('./users');
const { nowIso, mapAsync } = require('../utils/validation');

async function rowToRide(row) {
  if (!row) return null;
  return {
    id: row.id,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    passengerPhone: row.passenger_phone,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverPhone: row.driver_phone || '',
    status: row.status,
    origin: row.origin,
    destination: row.destination,
    distanceKm: row.distance_km,
    minutes: row.minutes,
    fare: row.fare,
    paymentMethod: row.payment_method,
    notes: row.notes || '',
    pickupCoords: row.pickup_lat !== null && row.pickup_lng !== null ? { lat: row.pickup_lat, lng: row.pickup_lng } : null,
    destinationCoords: row.destination_lat !== null && row.destination_lng !== null ? { lat: row.destination_lat, lng: row.destination_lng } : null,
    routeSource: row.route_source || 'manual',
    routeGeometry: row.route_geometry ? JSON.parse(row.route_geometry) : null,
    straightLineKm: row.straight_line_km,
    rating: await getRideRating(row.id),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason || ''
  };
}

async function upsertRideRating({ ride, passenger, rating, comment }) {
  const now = nowIso();
  const existing = await getRideRating(ride.id);
  if (existing) {
    await dbRun('UPDATE ride_ratings SET rating = ?, comment = ?, updated_at = ? WHERE ride_id = ?', [rating, comment, now, ride.id]);
    await audit(passenger.id, 'update_ride_rating', 'ride', ride.id, { rating, comment });
  } else {
    await dbRun(`
      INSERT INTO ride_ratings (id, ride_id, passenger_id, driver_id, rating, comment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), ride.id, ride.passengerId, ride.driverId, rating, comment, now, now]);
    await audit(passenger.id, 'create_ride_rating', 'ride', ride.id, { rating, comment });
  }
  const updatedRide = await getRideById(ride.id);
  await emitRideEvent('rated', updatedRide, { rating: updatedRide.rating });
  return updatedRide.rating;
}

async function insertRide(ride) {
  await dbRun(`
    INSERT INTO rides (
      id, passenger_id, passenger_name, passenger_phone, driver_id, driver_name, driver_phone, status,
      origin, destination, distance_km, minutes, fare, payment_method, notes,
      pickup_lat, pickup_lng, destination_lat, destination_lng, route_source, route_geometry, straight_line_km, idempotency_key, created_at, accepted_at, finished_at, cancelled_at, cancelled_by, cancel_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    ride.id,
    ride.passengerId,
    ride.passengerName,
    ride.passengerPhone,
    ride.driverId,
    ride.driverName,
    ride.driverPhone || null,
    ride.status,
    ride.origin,
    ride.destination,
    ride.distanceKm,
    ride.minutes,
    ride.fare,
    ride.paymentMethod,
    ride.notes,
    ride.pickupCoords?.lat ?? null,
    ride.pickupCoords?.lng ?? null,
    ride.destinationCoords?.lat ?? null,
    ride.destinationCoords?.lng ?? null,
    ride.routeSource || 'manual',
    ride.routeGeometry ? JSON.stringify(ride.routeGeometry).slice(0, 250000) : null,
    Number.isFinite(Number(ride.straightLineKm)) ? Number(ride.straightLineKm) : null,
    ride.idempotencyKey || null,
    ride.createdAt,
    ride.acceptedAt,
    ride.finishedAt,
    ride.cancelledAt || null,
    ride.cancelledBy || null,
    ride.cancelReason || null
  ]);
  await audit(ride.passengerId, 'create_ride', 'ride', ride.id, { fare: ride.fare, status: ride.status });
}

async function getRideById(id) {
  return rowToRide(await dbGet('SELECT * FROM rides WHERE id = ?', [id]));
}

async function getAllRides() {
  return mapAsync(await dbAll('SELECT * FROM rides ORDER BY created_at DESC'), rowToRide);
}

function getDriverLocationStaleSeconds() {
  return Math.max(Number(envConfig.DRIVER_LOCATION_STALE_SECONDS || 120), 30);
}

function isDriverLocationFresh(user) {
  if (!user?.lastLocation?.updatedAt) return false;
  const updatedAt = Date.parse(user.lastLocation.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt <= getDriverLocationStaleSeconds() * 1000;
}

async function driverAvailable(origin = null) {
  const rows = await dbAll("SELECT * FROM users WHERE role = 'driver' AND status = 'approved' AND online = 1 ORDER BY updated_at DESC");
  const users = rows.map(rowToUser).filter(Boolean);
  if (!origin) return users;
  return users
    .filter(user => isDriverLocationFresh(user))
    .sort((left, right) => {
      const leftDistance = haversineDistanceKm(origin, left.lastLocation || { lat: origin.lat, lng: origin.lng });
      const rightDistance = haversineDistanceKm(origin, right.lastLocation || { lat: origin.lat, lng: origin.lng });
      return leftDistance - rightDistance;
    });
}

function normalizeRideStatus(status) {
  const map = {
    pending: 'pending',
    requested: 'pending',
    searching_driver: 'pending',
    accepted: 'accepted',
    driver_assigned: 'accepted',
    driver_arriving: 'accepted',
    driver_arrived: 'accepted',
    in_progress: 'accepted',
    finished: 'finished',
    completed: 'finished',
    cancelled: 'cancelled',
    cancelled_by_passenger: 'cancelled',
    cancelled_by_driver: 'cancelled',
    cancelled_by_admin: 'cancelled',
    no_driver_found: 'cancelled',
    no_show: 'cancelled'
  };
  return map[String(status || '').trim().toLowerCase()] || String(status || '').trim().toLowerCase();
}

function canTransitionRide(fromStatus, toStatus) {
  const from = normalizeRideStatus(fromStatus);
  const to = normalizeRideStatus(toStatus);
  const allowed = {
    pending: ['accepted', 'cancelled'],
    accepted: ['finished', 'cancelled'],
    finished: [],
    cancelled: []
  };
  return allowed[from]?.includes(to) ?? false;
}

function ensureRideTransition(ride, nextStatus) {
  if (!ride) throw new Error('Corrida não encontrada.');
  const from = normalizeRideStatus(ride.status);
  const to = normalizeRideStatus(nextStatus);
  if (!canTransitionRide(from, to)) {
    throw Object.assign(new Error('Transição de estado inválida para esta corrida.'), { statusCode: 409 });
  }
  return { from, to };
}

function canAccessRide(user, ride) {
  if (!user || !ride) return false;
  if (user.role === 'admin') return true;
  if (user.id === ride.passengerId) return true;
  if (ride.driverId && user.id === ride.driverId) return true;
  return false;
}

function canCancelRide(user, ride) {
  if (!canAccessRide(user, ride)) return false;
  if (!['pending', 'accepted'].includes(ride.status)) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'passenger') return user.id === ride.passengerId;
  if (user.role === 'driver') return ride.driverId === user.id;
  return false;
}

async function getRideTargetUser(ride, targetRole) {
  if (targetRole === 'passenger') return getUserById(ride.passengerId);
  if (targetRole === 'driver' && ride.driverId) return getUserById(ride.driverId);
  return null;
}

function buildContactMessage(ride, actor, targetRole) {
  const who = actor.role === 'driver' ? 'motorista' : actor.role === 'passenger' ? 'passageiro' : 'admin';
  const rideLabel = `${ride.origin} → ${ride.destination}`;
  if (targetRole === 'driver') return `Olá, aqui é ${actor.name} pelo PardoGo. Sobre a corrida ${rideLabel}.`;
  return `Olá, aqui é ${actor.name}, ${who} do PardoGo. Sobre a corrida ${rideLabel}.`;
}

async function logRideContact({ ride, actor, target, targetRole, channel, message }) {
  const contact = {
    id: crypto.randomUUID(),
    rideId: ride.id,
    actorUserId: actor.id,
    targetUserId: target.id,
    targetRole,
    channel,
    phone: target.phone,
    message: message || '',
    createdAt: nowIso()
  };
  await dbRun(`
    INSERT INTO ride_contacts (id, ride_id, actor_user_id, target_user_id, target_role, channel, phone, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [contact.id, contact.rideId, contact.actorUserId, contact.targetUserId, contact.targetRole, contact.channel, contact.phone, contact.message, contact.createdAt]);
  await audit(actor.id, 'contact_ride_participant', 'ride', ride.id, { targetRole, channel, targetUserId: target.id });
  await emitRealtime('contact-log', { type: 'contact-created', rideId: ride.id, targetRole, channel }, client => client.role === 'admin' || client.userId === ride.passengerId || client.userId === ride.driverId);
  return contact;
}

module.exports = {
  rowToRide,
  upsertRideRating,
  insertRide,
  getRideById,
  getAllRides,
  driverAvailable,
  ensureRideTransition,
  canAccessRide,
  canCancelRide,
  getRideTargetUser,
  buildContactMessage,
  logRideContact
};
