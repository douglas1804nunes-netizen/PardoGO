const crypto = require('crypto');
const { dbGet, dbAll, dbRun } = require('../db/pg');
const { audit } = require('./audit');
const { hashPassword } = require('./password');
const { getDriverRatingSummary } = require('./ratings');
const { nowIso, normalizePhone, isValidGender } = require('../utils/validation');

async function createUserObject({ name, phone, password, role, vehicle, plate, cnhNumber, vehicleModel, vehicleColor, documentStatus, documentsNote, termsAccepted, privacyAccepted, status, email, birthdate, gender }) {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    phone: normalizePhone(phone),
    email: email ? String(email).trim().toLowerCase() : '',
    birthdate: birthdate || null,
    gender: isValidGender(gender) ? gender : 'unspecified',
    passwordHash: await hashPassword(password),
    role,
    status: status || (role === 'driver' ? 'pending' : 'active'),
    online: false,
    lastLocation: null,
    vehicle: vehicle ? String(vehicle).trim() : '',
    plate: plate ? String(plate).trim().toUpperCase() : '',
    cnhNumber: cnhNumber ? String(cnhNumber).trim() : '',
    vehicleModel: vehicleModel ? String(vehicleModel).trim() : '',
    vehicleColor: vehicleColor ? String(vehicleColor).trim() : '',
    documentStatus: documentStatus || (role === 'driver' ? 'pending_review' : 'not_sent'),
    documentsNote: documentsNote ? String(documentsNote).trim() : '',
    termsAcceptedAt: termsAccepted ? now : null,
    privacyAcceptedAt: privacyAccepted ? now : null,
    createdAt: now,
    updatedAt: now
  };
}

async function insertUser(user) {
  await dbRun(`
    INSERT INTO users (
      id, name, phone, email, birthdate, gender, password_hash, role, status, online, vehicle, plate,
      cnh_number, vehicle_model, vehicle_color, document_status, documents_note, terms_accepted_at, privacy_accepted_at,
      last_lat, last_lng, last_accuracy, last_location_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    user.id,
    user.name,
    user.phone,
    user.email || '',
    user.birthdate || null,
    user.gender || 'unspecified',
    user.passwordHash,
    user.role,
    user.status,
    user.online ? 1 : 0,
    user.vehicle || '',
    user.plate || '',
    user.cnhNumber || '',
    user.vehicleModel || '',
    user.vehicleColor || '',
    user.documentStatus || 'not_sent',
    user.documentsNote || '',
    user.termsAcceptedAt || null,
    user.privacyAcceptedAt || null,
    user.lastLocation?.lat || null,
    user.lastLocation?.lng || null,
    user.lastLocation?.accuracy || null,
    user.lastLocation?.updatedAt || null,
    user.createdAt,
    user.updatedAt
  ]);
  await audit(user.id, 'create_user', 'user', user.id, { role: user.role, status: user.status });
}

function rowToUser(row) {
  if (!row) return null;
  const lastLocation = row.last_lat !== null && row.last_lng !== null ? {
    lat: row.last_lat,
    lng: row.last_lng,
    accuracy: row.last_accuracy,
    updatedAt: row.last_location_updated_at
  } : null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    birthdate: row.birthdate || null,
    gender: row.gender || 'unspecified',
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    online: Boolean(row.online),
    lastLocation,
    vehicle: row.vehicle || '',
    plate: row.plate || '',
    cnhNumber: row.cnh_number || '',
    vehicleModel: row.vehicle_model || '',
    vehicleColor: row.vehicle_color || '',
    documentStatus: row.document_status || 'not_sent',
    documentsNote: row.documents_note || '',
    termsAcceptedAt: row.terms_accepted_at || null,
    privacyAcceptedAt: row.privacy_accepted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  if (safe.role === 'driver') {
    const summary = await getDriverRatingSummary(safe.id);
    safe.reviewsCount = summary.reviewsCount;
    safe.averageRating = summary.averageRating;
  }
  return safe;
}

async function getUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  let row = await dbGet('SELECT * FROM users WHERE phone = ?', [normalized]);
  if (!row) {
    const legacy = String(phone || '').trim().toLowerCase();
    if (legacy && legacy !== normalized) {
      row = await dbGet('SELECT * FROM users WHERE phone = ?', [legacy]);
    }
  }
  return rowToUser(row);
}

async function getUserById(id) {
  return rowToUser(await dbGet('SELECT * FROM users WHERE id = ?', [id]));
}

async function getAllUsers() {
  return (await dbAll('SELECT * FROM users ORDER BY created_at DESC')).map(rowToUser);
}

module.exports = {
  createUserObject,
  insertUser,
  rowToUser,
  publicUser,
  getUserByPhone,
  getUserById,
  getAllUsers
};
