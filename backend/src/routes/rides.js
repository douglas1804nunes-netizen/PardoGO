const crypto = require('crypto');
const { dbGet, dbAll, dbRun, isUniqueConstraintError } = require('../db/pg');
const { requireAuth, requireApprovedDriver } = require('../http/auth');
const { send, parseBody } = require('../http/response');
const { audit } = require('../services/audit');
const { assertCoordsWithinAllowedCity, calculateRoute, coordsFromBody } = require('../services/geo');
const { emitRideEvent } = require('../services/realtime');
const { rowToRide, upsertRideRating, insertRide, getRideById, driverAvailable, ensureRideTransition, canAccessRide, canCancelRide, getRideTargetUser, buildContactMessage, logRideContact } = require('../services/rides');
const { getTariffRules, calculateFare } = require('../services/tariff');
const { publicUser } = require('../services/users');
const { nowIso, normalizePaymentMethod, mapAsync, normalizeIdempotencyKey, validateRequired, numericPhone, phoneForWhatsapp } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/api/rides/estimate') {
    const body = await parseBody(req);
    const { origin, destination } = coordsFromBody(body);
    let route = null;
    let distanceKm = Number(body.distanceKm || 0);
    let minutes = Number(body.minutes || 0);
    if (origin && destination && body.useRoute !== false) {
      assertCoordsWithinAllowedCity(origin, destination);
      route = await calculateRoute(origin, destination);
      distanceKm = route.distanceKm;
      minutes = route.minutes;
    }
    const rules = await getTariffRules();
    const fare = calculateFare(distanceKm, minutes, rules);
    return send(res, 200, {
      ok: true,
      fare,
      distanceKm,
      minutes,
      routeSource: route?.source || 'manual',
      routeGeometry: route?.geometry || null,
      straightLineKm: route?.straightLineKm || null,
      routeFallback: Boolean(route?.fallback),
      driverShare: Number((fare * Number(rules.driverSharePercent || 80) / 100).toFixed(2)),
      rules
    });
  }

  if (method === 'POST' && pathname === '/api/rides') {
    const user = await requireAuth(req, res, ['passenger', 'admin']);
    if (!user) return;
    const body = await parseBody(req);
    const missing = validateRequired(['origin', 'destination'], body);
    if (missing) return send(res, 400, { ok: false, error: missing });
    const paymentMethod = normalizePaymentMethod(body.paymentMethod || 'Pix');
    if (!paymentMethod) {
      return send(res, 400, { ok: false, error: 'Forma de pagamento inválida. Use Pix ou Dinheiro.' });
    }
    const { origin: originCoords, destination: destinationCoords } = coordsFromBody(body);
    let route = null;
    let distanceKm = Math.max(Number(body.distanceKm || 2), 0.5);
    let minutes = Math.max(Number(body.minutes || Math.ceil(distanceKm * 4)), 3);
    if (originCoords && destinationCoords && body.useRoute !== false) {
      assertCoordsWithinAllowedCity(originCoords, destinationCoords);
      route = await calculateRoute(originCoords, destinationCoords);
      distanceKm = Math.max(Number(route.distanceKm || distanceKm), 0.5);
      minutes = Math.max(Number(route.minutes || minutes), 3);
    }
    const rules = await getTariffRules();
    const fare = calculateFare(distanceKm, minutes, rules);
    const availableDrivers = await (originCoords ? driverAvailable(originCoords) : driverAvailable());
    const rideIdempotencyKey = normalizeIdempotencyKey(body.idempotencyKey || null);
    if (rideIdempotencyKey) {
      const existing = await dbGet('SELECT * FROM rides WHERE passenger_id = ? AND idempotency_key = ? LIMIT 1', [user.id, rideIdempotencyKey]);
      if (existing) {
        const existingRide = await rowToRide(existing);
        return send(res, 200, {
          ok: true,
          idempotentReplay: true,
          message: 'Requisição repetida detectada. Retornando corrida já criada.',
          ride: existingRide,
          availableDrivers: await mapAsync(availableDrivers, publicUser)
        });
      }
    }
    const ride = {
      id: crypto.randomUUID(),
      passengerId: user.id,
      passengerName: user.name,
      passengerPhone: user.phone,
      driverId: null,
      driverName: null,
      driverPhone: null,
      status: 'pending',
      origin: String(body.origin).trim(),
      destination: String(body.destination).trim(),
      distanceKm,
      minutes,
      fare,
      paymentMethod,
      notes: String(body.notes || '').trim(),
      pickupCoords: originCoords,
      destinationCoords,
      routeSource: route?.source || body.routeSource || 'manual',
      routeGeometry: route?.geometry || body.routeGeometry || null,
      straightLineKm: route?.straightLineKm || null,
      idempotencyKey: rideIdempotencyKey,
      createdAt: nowIso(),
      acceptedAt: null,
      finishedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null
    };
    try {
      await insertRide(ride);
    } catch (error) {
      if (isUniqueConstraintError(error) && rideIdempotencyKey) {
        const existing = await dbGet('SELECT * FROM rides WHERE passenger_id = ? AND idempotency_key = ? LIMIT 1', [user.id, rideIdempotencyKey]);
        if (existing) {
          const existingRide = await rowToRide(existing);
          return send(res, 200, {
            ok: true,
            idempotentReplay: true,
            message: 'Requisição concorrente detectada. Retornando corrida já criada.',
            ride: existingRide,
            availableDrivers: await mapAsync(availableDrivers, publicUser)
          });
        }
      }
      throw error;
    }
    await emitRideEvent('created', ride, { availableDrivers: await mapAsync(availableDrivers, publicUser) });
    return send(res, 201, {
      ok: true,
      message: availableDrivers.length ? 'Corrida enviada para os motoristas online.' : 'Corrida criada, mas não há motorista online agora.',
      ride,
      availableDrivers: await mapAsync(availableDrivers, publicUser)
    });
  }

  if (method === 'GET' && pathname === '/api/rides/my') {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    let rows = [];
    if (user.role === 'passenger') {
      rows = await dbAll('SELECT * FROM rides WHERE passenger_id = ? ORDER BY created_at DESC', [user.id]);
    }
    if (user.role === 'driver') {
      rows = await dbAll('SELECT * FROM rides WHERE driver_id = ? OR status = ? ORDER BY created_at DESC', [user.id, 'pending']);
    }
    if (user.role === 'admin') {
      rows = await dbAll('SELECT * FROM rides ORDER BY created_at DESC');
    }
    return send(res, 200, { ok: true, rides: await mapAsync(rows, rowToRide) });
  }

  const acceptMatch = pathname.match(/^\/api\/rides\/([^/]+)\/accept$/);
  if (method === 'PATCH' && acceptMatch) {
    const user = await requireAuth(req, res, ['driver']);
    if (!user) return;
    if (!requireApprovedDriver(user, res)) return;
    const ride = await getRideById(acceptMatch[1]);
    if (!ride) return send(res, 404, { ok: false, error: 'Corrida não encontrada.' });
    const acceptedAt = nowIso();
    try {
      ensureRideTransition(ride, 'accepted');
    } catch (error) {
      return send(res, error.statusCode || 409, { ok: false, error: error.message });
    }
    const result = await dbRun('UPDATE rides SET status = ?, driver_id = ?, driver_name = ?, driver_phone = ?, accepted_at = ? WHERE id = ? AND status = ?',
      ['accepted', user.id, user.name, user.phone, acceptedAt, ride.id, 'pending']);
    if (!result.changes) {
      return send(res, 409, { ok: false, error: 'Essa corrida já foi aceita ou finalizada.' });
    }
    await audit(user.id, 'accept_ride', 'ride', ride.id, { driverName: user.name });
    const updatedRide = await getRideById(ride.id);
    await emitRideEvent('accepted', updatedRide, { driver: await publicUser(user) });
    return send(res, 200, { ok: true, ride: updatedRide });
  }

  const finishMatch = pathname.match(/^\/api\/rides\/([^/]+)\/finish$/);
  if (method === 'PATCH' && finishMatch) {
    const user = await requireAuth(req, res, ['driver', 'admin']);
    if (!user) return;
    const ride = await getRideById(finishMatch[1]);
    if (!ride) return send(res, 404, { ok: false, error: 'Corrida não encontrada.' });
    if (user.role === 'driver' && ride.driverId !== user.id) {
      return send(res, 403, { ok: false, error: 'Essa corrida pertence a outro motorista.' });
    }
    try {
      ensureRideTransition(ride, 'finished');
    } catch (error) {
      return send(res, error.statusCode || 409, { ok: false, error: error.message });
    }
    const finishedAt = nowIso();
    await dbRun('UPDATE rides SET status = ?, finished_at = ? WHERE id = ?', ['finished', finishedAt, ride.id]);
    await audit(user.id, 'finish_ride', 'ride', ride.id, { status: 'finished' });
    const updatedRide = await getRideById(ride.id);
    await emitRideEvent('finished', updatedRide);
    return send(res, 200, { ok: true, ride: updatedRide });
  }

  const cancelMatch = pathname.match(/^\/api\/rides\/([^/]+)\/cancel$/);
  if (method === 'PATCH' && cancelMatch) {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    const ride = await getRideById(cancelMatch[1]);
    if (!ride) return send(res, 404, { ok: false, error: 'Corrida não encontrada.' });
    if (!canCancelRide(user, ride)) return send(res, 403, { ok: false, error: 'Você não pode cancelar essa corrida.' });
    const body = await parseBody(req);
    const reason = String(body.reason || 'Sem motivo informado').trim().slice(0, 240) || 'Sem motivo informado';
    try {
      ensureRideTransition(ride, 'cancelled');
    } catch (error) {
      return send(res, error.statusCode || 409, { ok: false, error: error.message });
    }
    const cancelledAt = nowIso();
    const result = await dbRun(`
      UPDATE rides
      SET status = ?, cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
      WHERE id = ? AND status IN ('pending', 'accepted')
    `, ['cancelled', cancelledAt, user.id, reason, ride.id]);
    if (!result.changes) {
      return send(res, 409, { ok: false, error: 'Corrida já cancelada ou finalizada.' });
    }
    await audit(user.id, 'cancel_ride', 'ride', ride.id, { reason, previousStatus: ride.status });
    const updatedRide = await getRideById(ride.id);
    await emitRideEvent('cancelled', updatedRide, { cancelledBy: await publicUser(user), reason });
    return send(res, 200, { ok: true, ride: updatedRide });
  }

  const contactMatch = pathname.match(/^\/api\/rides\/([^/]+)\/contact$/);
  if (method === 'POST' && contactMatch) {
    const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
    if (!user) return;
    const ride = await getRideById(contactMatch[1]);
    if (!ride) return send(res, 404, { ok: false, error: 'Corrida não encontrada.' });
    if (!canAccessRide(user, ride)) return send(res, 403, { ok: false, error: 'Você não participa dessa corrida.' });
    const body = await parseBody(req);
    const channel = body.channel === 'call' ? 'call' : 'whatsapp';
    const targetRole = body.target === 'driver' ? 'driver' : 'passenger';
    if (user.role === 'passenger' && targetRole !== 'driver') return send(res, 400, { ok: false, error: 'Passageiro só pode contatar o motorista dessa corrida.' });
    if (user.role === 'driver' && targetRole !== 'passenger') return send(res, 400, { ok: false, error: 'Motorista só pode contatar o passageiro dessa corrida.' });
    const target = await getRideTargetUser(ride, targetRole);
    if (!target) return send(res, 404, { ok: false, error: targetRole === 'driver' ? 'Ainda não há motorista para essa corrida.' : 'Passageiro não encontrado.' });
    if (target.status === 'blocked') return send(res, 403, { ok: false, error: 'Usuário de destino está bloqueado.' });
    const message = String(body.message || buildContactMessage(ride, user, targetRole)).slice(0, 400);
    const contact = await logRideContact({ ride, actor: user, target, targetRole, channel, message });
    const digits = numericPhone(target.phone);
    const whatsappPhone = phoneForWhatsapp(target.phone);
    return send(res, 200, {
      ok: true,
      contact,
      target: await publicUser(target),
      phone: target.phone,
      telUrl: digits ? `tel:${digits}` : '',
      whatsappUrl: whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}` : '',
      message
    });
  }

  const ratingMatch = pathname.match(/^\/api\/rides\/([^/]+)\/rating$/);
  if (method === 'POST' && ratingMatch) {
    const user = await requireAuth(req, res, ['passenger']);
    if (!user) return;
    const ride = await getRideById(ratingMatch[1]);
    if (!ride) return send(res, 404, { ok: false, error: 'Corrida não encontrada.' });
    if (ride.passengerId !== user.id) return send(res, 403, { ok: false, error: 'Você só pode avaliar suas próprias corridas.' });
    if (ride.status !== 'finished') return send(res, 409, { ok: false, error: 'A corrida precisa estar finalizada para receber avaliação.' });
    if (!ride.driverId) return send(res, 409, { ok: false, error: 'Corrida sem motorista não pode ser avaliada.' });
    const body = await parseBody(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return send(res, 400, { ok: false, error: 'A nota precisa ser um número inteiro de 1 a 5.' });
    }
    const comment = String(body.comment || '').trim().slice(0, 400);
    const savedRating = await upsertRideRating({ ride, passenger: user, rating, comment });
    return send(res, 200, { ok: true, rating: savedRating, ride: await getRideById(ride.id) });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
