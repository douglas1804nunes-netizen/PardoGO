const { ADMIN_INITIAL_PHONE, GENDER_OPTIONS, MIN_USER_AGE_YEARS } = require('../config');

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim().toLowerCase();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits && digits === ADMIN_INITIAL_PHONE) return ADMIN_INITIAL_PHONE;
  return digits;
}

function isValidPhone(phone) {
  if (phone === ADMIN_INITIAL_PHONE) return true;
  return /^\d{10,13}$/.test(phone);
}

function normalizePaymentMethod(value) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'pix') return 'Pix';
  if (normalized === 'dinheiro') return 'Dinheiro';
  return '';
}

function isStrongPassword(value) {
  const text = String(value || '');
  return /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{6,}$/.test(text);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidGender(value) {
  return GENDER_OPTIONS.includes(String(value || ''));
}

function isValidBirthdate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) return false;
  const ageYears = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  return ageYears >= MIN_USER_AGE_YEARS && ageYears < 120;
}

function mapAsync(items, fn) {
  return Promise.all(items.map(fn));
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (!/^[A-Za-z0-9:_\-.]{8,120}$/.test(normalized)) {
    throw Object.assign(new Error('idempotencyKey inválida. Use 8-120 caracteres [A-Za-z0-9:_-.].'), { statusCode: 400 });
  }
  return normalized;
}

function validateRequired(fields, body) {
  for (const field of fields) {
    if (!String(body[field] || '').trim()) return `Campo obrigatório: ${field}`;
  }
  return null;
}

function numericPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function phoneForWhatsapp(phone) {
  const digits = numericPhone(phone);
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}

module.exports = {
  nowIso,
  normalizePhone,
  isValidPhone,
  normalizePaymentMethod,
  isStrongPassword,
  isValidEmail,
  isValidGender,
  isValidBirthdate,
  mapAsync,
  normalizeIdempotencyKey,
  validateRequired,
  numericPhone,
  phoneForWhatsapp
};
