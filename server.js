const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getEnvConfig, validateEnvConfig } = require('./src/config/env');
const {
  openPool,
  dbExec,
  dbGet,
  dbAll,
  dbRun,
  closePool,
  isUniqueConstraintError
} = require('./src/db/pg');

const envConfig = getEnvConfig();
validateEnvConfig(envConfig);

const APP_VERSION = '1.4.0';
const NODE_ENV = envConfig.NODE_ENV;
const PORT = Number(envConfig.PORT || 5173);
const DATABASE_URL = envConfig.DATABASE_URL;
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_BASE_URL = envConfig.APP_BASE_URL;
const CANONICAL_BASE_URL = envConfig.CANONICAL_BASE_URL || envConfig.APP_BASE_URL;
const SESSION_DAYS = Number(envConfig.SESSION_DAYS || 7);
const ADMIN_LEGACY_ALIAS = 'admin';
const ADMIN_INITIAL_PHONE_RAW = String(envConfig.ADMIN_INITIAL_PHONE || '').trim().toLowerCase();
const ADMIN_INITIAL_PHONE = ADMIN_INITIAL_PHONE_RAW === ADMIN_LEGACY_ALIAS
  ? ADMIN_LEGACY_ALIAS
  : ADMIN_INITIAL_PHONE_RAW.replace(/\D/g, '');
const ADMIN_INITIAL_PASSWORD = String(envConfig.ADMIN_INITIAL_PASSWORD || '');
const GOOGLE_CLIENT_ID = String(envConfig.GOOGLE_CLIENT_ID || '').trim();
const FORCE_HTTPS = envConfig.FORCE_HTTPS === true;
const TRUST_PROXY = envConfig.TRUST_PROXY === true;
const REQUIRE_SECURE_ENV = envConfig.REQUIRE_SECURE_ENV === true;
const APP_BASE_ORIGIN = (() => {
  try { return new URL(APP_BASE_URL).origin; } catch { return ''; }
})();
const CANONICAL_BASE_ORIGIN = (() => {
  try { return new URL(CANONICAL_BASE_URL).origin; } catch { return APP_BASE_ORIGIN; }
})();
const CANONICAL_HOST = (() => {
  try { return new URL(CANONICAL_BASE_URL).host; } catch { return ''; }
})();
const CANONICAL_REDIRECT_HOSTS = envConfig.CANONICAL_REDIRECT_HOSTS || [];
const DEFAULT_CORS_ORIGINS = envConfig.DEFAULT_CORS_ORIGINS || [];
const CORS_ORIGIN = String(envConfig.CORS_ORIGIN || DEFAULT_CORS_ORIGINS.join(',') || APP_BASE_ORIGIN || '').trim();
const CORS_ALLOW_ALL = CORS_ORIGIN === '*';
const CORS_KNOWN_RENDER_ORIGINS = ['https://pardogo-8yn0.onrender.com'];
const CORS_CAPACITOR_ORIGINS = [
  'https://localhost',
];
const CORS_LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const CORS_ALLOWED_ORIGINS = CORS_ALLOW_ALL
  ? ['*']
  : Array.from(new Set([
    ...CORS_ORIGIN.split(',').map(item => item.trim()).filter(Boolean),
    ...DEFAULT_CORS_ORIGINS,
    ...CORS_KNOWN_RENDER_ORIGINS,
    ...CORS_CAPACITOR_ORIGINS,
    ...(NODE_ENV === 'production' ? [] : CORS_LOCAL_DEV_ORIGINS)
  ]));
const RATE_LIMIT_WINDOW_MS = Number(envConfig.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(envConfig.RATE_LIMIT_MAX || 300);
const rateLimitBuckets = new Map();
const LOGIN_MAX_ATTEMPTS = Number(envConfig.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCK_MINUTES = Number(envConfig.LOGIN_LOCK_MINUTES || 15);
const loginAttemptBuckets = new Map();
const MAP_DEFAULT_CENTER = { lat: -21.302, lng: -52.833, label: 'Santa Rita do Pardo - MS' };
const CITY_GEOFENCE_RADIUS_KM = Number(envConfig.CITY_GEOFENCE_RADIUS_KM || 55);
const CITY_AVERAGE_SPEED_KMH = Number(envConfig.CITY_AVERAGE_SPEED_KMH || 28);
const MAP_TIMEOUT_MS = Number(envConfig.MAP_TIMEOUT_MS || 5500);
const eventClients = new Map();
const sseTickets = new Map();
const SSE_PING_MS = Number(envConfig.SSE_PING_MS || 25000);
const SSE_TICKET_TTL_MS = Number(envConfig.SSE_TICKET_TTL_MS || 60_000);
const PAYMENT_METHODS = ['Pix', 'Dinheiro'];

const FIXED_FARE_BRL = 20;

const defaultTariffRules = {
  base: 5,
  perKm: 3.2,
  perMin: 0.45,
  min: 12,
  driverSharePercent: 80,
  city: 'Santa Rita do Pardo - MS'
};

let isDbClosed = false;
let isShuttingDown = false;
const ssePingIntervals = new Set();

async function openDatabase() {
  openPool(DATABASE_URL);
  isDbClosed = false;
  await migrate();
  await seed();
}

async function migrate() {
  await dbExec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tariff_rules (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base REAL NOT NULL,
      per_km REAL NOT NULL,
      per_min REAL NOT NULL,
      min REAL NOT NULL,
      driver_share_percent REAL NOT NULL,
      city TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'passenger', 'driver')),
      status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'approved', 'blocked')),
      online INTEGER NOT NULL DEFAULT 0,
      wallet_balance REAL NOT NULL DEFAULT 0,
      vehicle TEXT DEFAULT '',
      plate TEXT DEFAULT '',
      cnh_number TEXT DEFAULT '',
      vehicle_model TEXT DEFAULT '',
      vehicle_color TEXT DEFAULT '',
      document_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (document_status IN ('not_sent', 'pending_review', 'verified', 'rejected')),
      documents_note TEXT DEFAULT '',
      terms_accepted_at TEXT,
      privacy_accepted_at TEXT,
      last_lat REAL,
      last_lng REAL,
      last_accuracy REAL,
      last_location_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin_role ON users(role) WHERE role = 'admin';

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      passenger_id TEXT NOT NULL,
      passenger_name TEXT NOT NULL,
      passenger_phone TEXT NOT NULL,
      driver_id TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'finished', 'cancelled')),
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      distance_km REAL NOT NULL,
      minutes INTEGER NOT NULL,
      fare REAL NOT NULL,
      payment_method TEXT NOT NULL,
      notes TEXT DEFAULT '',
      pickup_lat REAL,
      pickup_lng REAL,
      destination_lat REAL,
      destination_lng REAL,
      route_source TEXT DEFAULT 'manual',
      route_geometry TEXT,
      straight_line_km REAL,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      finished_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      FOREIGN KEY(passenger_id) REFERENCES users(id),
      FOREIGN KEY(driver_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
    CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
    CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
    CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rides_passenger_idempotency
    ON rides(passenger_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      description TEXT DEFAULT '',
      reference_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed', 'pending')),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created ON wallet_transactions(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency ON wallet_transactions(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pix_topups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'awaiting_confirmation', 'confirmed', 'rejected', 'expired')),
      pix_key TEXT NOT NULL,
      pix_payload TEXT NOT NULL,
      qr_code_url TEXT NOT NULL,
      txid TEXT NOT NULL,
      payer_note TEXT DEFAULT '',
      admin_note TEXT DEFAULT '',
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(confirmed_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pix_topups_user_created ON pix_topups(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pix_topups_status_created ON pix_topups(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pix_topups_txid ON pix_topups(txid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_topups_txid_unique ON pix_topups(txid);

    CREATE TABLE IF NOT EXISTS ride_contacts (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      target_role TEXT NOT NULL CHECK (target_role IN ('passenger', 'driver')),
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'call')),
      phone TEXT NOT NULL,
      message TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(ride_id) REFERENCES rides(id),
      FOREIGN KEY(actor_user_id) REFERENCES users(id),
      FOREIGN KEY(target_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ride_contacts_ride ON ride_contacts(ride_id);
    CREATE INDEX IF NOT EXISTS idx_ride_contacts_created ON ride_contacts(created_at);

    CREATE TABLE IF NOT EXISTS ride_ratings (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL UNIQUE,
      passenger_id TEXT NOT NULL,
      driver_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(ride_id) REFERENCES rides(id),
      FOREIGN KEY(passenger_id) REFERENCES users(id),
      FOREIGN KEY(driver_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ride_ratings_driver ON ride_ratings(driver_id);
    CREATE INDEX IF NOT EXISTS idx_ride_ratings_created ON ride_ratings(created_at);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed')),
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_support_user ON support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_created ON support_tickets(created_at);

    CREATE TABLE IF NOT EXISTS ride_reports (
      id TEXT PRIMARY KEY,
      ride_id TEXT,
      reporter_user_id TEXT NOT NULL,
      reported_role TEXT NOT NULL CHECK (reported_role IN ('passenger', 'driver', 'platform')),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(ride_id) REFERENCES rides(id),
      FOREIGN KEY(reporter_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_reports_reporter ON ride_reports(reporter_user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON ride_reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON ride_reports(created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);
}

async function seed() {
  const now = new Date().toISOString();
  const version = await dbGet('SELECT value FROM app_meta WHERE key = ?', ['version']);
  if (!version) {
    await dbRun('INSERT INTO app_meta (key, value) VALUES (?, ?)', ['appName', 'PardoGo']);
    await dbRun('INSERT INTO app_meta (key, value) VALUES (?, ?)', ['version', APP_VERSION]);
    await dbRun('INSERT INTO app_meta (key, value) VALUES (?, ?)', ['createdAt', now]);
  }

  const rules = await dbGet('SELECT id FROM tariff_rules WHERE id = 1');
  if (!rules) {
    await dbRun(`
      INSERT INTO tariff_rules (id, base, per_km, per_min, min, driver_share_percent, city, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `, [
      defaultTariffRules.base,
      defaultTariffRules.perKm,
      defaultTariffRules.perMin,
      defaultTariffRules.min,
      defaultTariffRules.driverSharePercent,
      defaultTariffRules.city,
      now
    ]);
  }

  const admin = await dbGet('SELECT id, role, status FROM users WHERE phone = ?', [ADMIN_INITIAL_PHONE]);
  if (!admin) {
    const adminUser = createUserObject({
      name: 'Administrador PardoGo',
      phone: ADMIN_INITIAL_PHONE,
      password: ADMIN_INITIAL_PASSWORD,
      role: 'admin',
      status: 'active'
    });
    await insertUser(adminUser);
  } else {
    await dbRun(`
      UPDATE users
      SET role = 'admin',
          status = 'active',
          password_hash = ?,
          updated_at = ?
      WHERE id = ?
    `, [hashPassword(ADMIN_INITIAL_PASSWORD), now, admin.id]);
    await audit(admin.id, 'repair_admin_alias', 'user', admin.id, { phone: ADMIN_INITIAL_PHONE });
  }

  const canonicalAdmin = await dbGet('SELECT id FROM users WHERE phone = ?', [ADMIN_INITIAL_PHONE]);
  const otherAdmins = await dbAll('SELECT id, phone FROM users WHERE role = ? AND phone <> ?', ['admin', ADMIN_INITIAL_PHONE]);
  if (otherAdmins.length) {
    await dbRun(`
      UPDATE users
      SET role = 'passenger',
          status = CASE WHEN status = 'blocked' THEN 'blocked' ELSE 'active' END,
          online = 0,
          updated_at = ?
      WHERE role = 'admin' AND phone <> ?
    `, [now, ADMIN_INITIAL_PHONE]);
    await audit(canonicalAdmin?.id || null, 'enforce_single_admin', 'user', canonicalAdmin?.id || null, {
      keptAdminPhone: ADMIN_INITIAL_PHONE,
      demotedAdmins: otherAdmins.map(item => item.phone)
    });
  }
}

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

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = 180000) {
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;

  // Compatibilidade com hashes das etapas antigas: salt:hash.
  if (stored.includes(':') && !stored.startsWith('pbkdf2_')) {
    const [salt, hash] = stored.split(':');
    const candidate = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
    return safeEqual(hash, candidate);
  }

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const hash = parts[3];
  const candidate = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return safeEqual(hash, candidate);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const token_hash = tokenHash(token);
  const created_at = nowIso();
  const expires_at = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await dbRun(`
    INSERT INTO sessions (token_hash, user_id, user_agent, ip, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `, [
    token_hash,
    user.id,
    String(req.headers['user-agent'] || '').slice(0, 300),
    String(req.socket.remoteAddress || '').slice(0, 80),
    created_at,
    expires_at
  ]);
  await audit(user.id, 'login', 'session', token_hash, { expiresAt: expires_at });
  return { token, expiresAt: expires_at };
}

async function revokeSession(token) {
  if (!token) return;
  await dbRun('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [nowIso(), tokenHash(token)]);
}

async function cleanupSessions() {
  await dbRun('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL', [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]);
}

function createUserObject({ name, phone, password, role, vehicle, plate, cnhNumber, vehicleModel, vehicleColor, documentStatus, documentsNote, termsAccepted, privacyAccepted, status }) {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    phone: normalizePhone(phone),
    passwordHash: hashPassword(password),
    role,
    status: status || (role === 'driver' ? 'pending' : 'active'),
    online: false,
    walletBalance: 0,
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
      id, name, phone, password_hash, role, status, online, wallet_balance, vehicle, plate,
      cnh_number, vehicle_model, vehicle_color, document_status, documents_note, terms_accepted_at, privacy_accepted_at,
      last_lat, last_lng, last_accuracy, last_location_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    user.id,
    user.name,
    user.phone,
    user.passwordHash,
    user.role,
    user.status,
    user.online ? 1 : 0,
    Number(user.walletBalance || 0),
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
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    online: Boolean(row.online),
    walletBalance: Number(Number(row.wallet_balance || 0).toFixed(2)),
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

function mapAsync(items, fn) {
  return Promise.all(items.map(fn));
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

async function getOAuthAccount(provider, providerUserId) {
  return dbGet('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?', [provider, providerUserId]);
}

async function createOAuthAccount({ provider, providerUserId, userId, email }) {
  const now = nowIso();
  const record = {
    id: crypto.randomUUID(),
    provider: String(provider || '').trim().toLowerCase(),
    providerUserId: String(providerUserId || '').trim(),
    userId,
    email: email ? String(email).trim().toLowerCase() : null,
    createdAt: now,
    updatedAt: now
  };
  await dbRun(`
    INSERT INTO oauth_accounts (id, provider, provider_user_id, user_id, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [record.id, record.provider, record.providerUserId, record.userId, record.email, record.createdAt, record.updatedAt]);
  return record;
}

async function generateOAuthPlaceholderPhone() {
  for (let i = 0; i < 10; i++) {
    const candidate = `99${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    if (!(await getUserByPhone(candidate))) return candidate;
  }
  return `99${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Cadastro Google indisponível: GOOGLE_CLIENT_ID não configurado no servidor.');
  }
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(credential || ''))}`);
  if (!response.ok) {
    throw new Error('Token Google inválido ou expirado.');
  }
  const payload = await response.json();
  if (payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Token Google com client_id inválido para este aplicativo.');
  }
  if (!(payload.email_verified === 'true' || payload.email_verified === true)) {
    throw new Error('Conta Google sem e-mail verificado.');
  }
  if (!payload.sub) {
    throw new Error('Token Google sem identificador de usuário.');
  }
  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email).toLowerCase() : null,
    name: payload.name ? String(payload.name) : 'Usuário Google'
  };
}

async function getAllUsers() {
  return (await dbAll('SELECT * FROM users ORDER BY created_at DESC')).map(rowToUser);
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

async function getTariffRules() {
  const row = await dbGet('SELECT * FROM tariff_rules WHERE id = 1');
  return {
    base: row.base,
    perKm: row.per_km,
    perMin: row.per_min,
    min: row.min,
    driverSharePercent: row.driver_share_percent,
    city: row.city
  };
}

async function updateTariffRules(next) {
  await dbRun(`
    UPDATE tariff_rules
    SET base = ?, per_km = ?, per_min = ?, min = ?, driver_share_percent = ?, city = ?, updated_at = ?
    WHERE id = 1
  `, [next.base, next.perKm, next.perMin, next.min, next.driverSharePercent, next.city || defaultTariffRules.city, nowIso()]);
  await audit(null, 'update_tariff', 'tariff_rules', '1', next);
}

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


function rowToRating(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id,
    passengerId: row.passenger_id,
    driverId: row.driver_id,
    rating: row.rating,
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getRideRating(rideId) {
  return rowToRating(await dbGet('SELECT * FROM ride_ratings WHERE ride_id = ?', [rideId]));
}

async function getDriverRatingSummary(driverId) {
  const row = await dbGet('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM ride_ratings WHERE driver_id = ?', [driverId]);
  return {
    reviewsCount: Number(row.count || 0),
    averageRating: Number(Number(row.average || 0).toFixed(2))
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


function securityHeaders(extra = {}, req = null) {
  const corsOrigin = resolveCorsOrigin(req);
  const connectSrc = NODE_ENV === 'production'
    ? "connect-src 'self' https: https://localhost"
    : "connect-src 'self' https: http://localhost:* http://127.0.0.1:* https://localhost";
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://unpkg.com https://accounts.google.com https://apis.google.com",
      "script-src-elem 'self' https://unpkg.com https://accounts.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://api.qrserver.com https://*.tile.openstreetmap.org https://unpkg.com https://images.pexels.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      connectSrc,
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '),
    ...extra
  };
  if (NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
  }
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
  }
  return headers;
}

function getClientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    const forwarded = String(req.headers['x-forwarded-for']).split(',').map(part => part.trim()).filter(Boolean);
    const candidate = forwarded[0] || '';
    // Aceita apenas IPv4/IPv6 esperados para evitar spoofing trivial do header.
    if (/^[a-f0-9:.]+$/i.test(candidate)) return candidate;
  }
  return String(req.socket.remoteAddress || 'local');
}

function resolveCorsOrigin(req) {
  if (CORS_ALLOW_ALL) return '*';
  const requestOrigin = String(req?.headers?.origin || '').trim();
  if (!requestOrigin) return '';
  if (CORS_ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return '';
}

function loginAttemptKey(req, phone) {
  return `${getClientIp(req)}:${String(phone || '').trim().toLowerCase()}`;
}

function clearLoginFailures(req, phone) {
  loginAttemptBuckets.delete(loginAttemptKey(req, phone));
}

function noteLoginFailure(req, phone) {
  const key = loginAttemptKey(req, phone);
  const now = Date.now();
  const lockMs = Math.max(LOGIN_LOCK_MINUTES, 1) * 60_000;
  const bucket = loginAttemptBuckets.get(key) || { failures: 0, lockedUntil: 0, updatedAt: now };
  if (bucket.lockedUntil && bucket.lockedUntil <= now) {
    bucket.failures = 0;
    bucket.lockedUntil = 0;
  }
  bucket.failures += 1;
  bucket.updatedAt = now;
  if (bucket.failures >= Math.max(LOGIN_MAX_ATTEMPTS, 1)) {
    bucket.lockedUntil = now + lockMs;
  }
  loginAttemptBuckets.set(key, bucket);
  return bucket;
}

function loginLockInfo(req, phone) {
  const key = loginAttemptKey(req, phone);
  const bucket = loginAttemptBuckets.get(key);
  if (!bucket) return null;
  const now = Date.now();
  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000))
    };
  }
  if (bucket.lockedUntil && bucket.lockedUntil <= now) {
    loginAttemptBuckets.delete(key);
  }
  return null;
}

function cleanupLoginAttemptBuckets() {
  const now = Date.now();
  const ttl = Math.max(LOGIN_LOCK_MINUTES, 1) * 60_000 * 2;
  for (const [key, bucket] of loginAttemptBuckets.entries()) {
    if ((bucket.updatedAt || 0) + ttl < now) loginAttemptBuckets.delete(key);
  }
}

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

function isRateLimited(req) {
  if (!RATE_LIMIT_MAX || RATE_LIMIT_MAX < 1) return false;
  cleanupLoginAttemptBuckets();
  const now = Date.now();
  const ip = getClientIp(req);
  const key = `${ip}:${Math.floor(now / RATE_LIMIT_WINDOW_MS)}`;
  const current = rateLimitBuckets.get(key) || 0;
  rateLimitBuckets.set(key, current + 1);
  if (rateLimitBuckets.size > 1500) {
    const oldestAllowed = Math.floor((now - RATE_LIMIT_WINDOW_MS * 2) / RATE_LIMIT_WINDOW_MS);
    for (const bucketKey of rateLimitBuckets.keys()) {
      const bucketWindow = Number(bucketKey.split(':').pop());
      if (bucketWindow < oldestAllowed) rateLimitBuckets.delete(bucketKey);
    }
  }
  return current + 1 > RATE_LIMIT_MAX;
}

function shouldRedirectHttps(req) {
  if (!FORCE_HTTPS) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return proto !== 'https' && !req.socket.encrypted;
}

function shouldRedirectCanonical(req) {
  if (!CANONICAL_HOST) return false;
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (!host) return false;
  const canonicalHost = CANONICAL_HOST.toLowerCase().split(':')[0];
  if (host === canonicalHost) return false;
  return CANONICAL_REDIRECT_HOSTS.includes(host);
}

function canonicalRedirectLocation(req) {
  return `${CANONICAL_BASE_ORIGIN}${req.url}`;
}

function validateProductionConfig() {
  const warnings = [];
  try {
    validateEnvConfig(envConfig);
  } catch (error) {
    if (NODE_ENV === 'production' && REQUIRE_SECURE_ENV) {
      throw error;
    }
    warnings.push(error.message);
  }
  if (NODE_ENV === 'production' && ADMIN_INITIAL_PASSWORD === '123456') {
    warnings.push('Troque ADMIN_INITIAL_PASSWORD antes de operar em produção.');
  }
  if (NODE_ENV === 'production' && !String(APP_BASE_URL).startsWith('https://')) {
    warnings.push('APP_BASE_URL precisa usar HTTPS em produção.');
  }
  if (NODE_ENV === 'production' && !FORCE_HTTPS) {
    warnings.push('Ative FORCE_HTTPS=1 quando estiver atrás de proxy com HTTPS.');
  }
  if (NODE_ENV === 'production' && CORS_ALLOW_ALL) {
    warnings.push('Evite CORS_ORIGIN=* em produção. Defina origem explícita do app/web.');
  }
  if (NODE_ENV === 'production') {
    const badOrigins = CORS_ALLOWED_ORIGINS.filter(origin => origin.startsWith('http://'));
    if (badOrigins.length) warnings.push(`Remova origens HTTP em produção: ${badOrigins.join(', ')}`);
  }
  if (warnings.length && REQUIRE_SECURE_ENV) {
    throw new Error(`Configuração insegura para produção: ${warnings.join(' ')}`);
  }
  return warnings;
}

function systemChecklist() {
  const warnings = validateProductionConfig();
  return {
    app: 'PardoGo',
    version: APP_VERSION,
    environment: NODE_ENV,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    baseUrl: APP_BASE_URL,
    port: PORT,
    database: {
      type: 'PostgreSQL',
      provider: 'Supabase'
    },
    security: {
      forceHttps: FORCE_HTTPS,
      trustProxy: TRUST_PROXY,
      sessionDays: SESSION_DAYS,
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimitMax: RATE_LIMIT_MAX,
      secureAdminPasswordConfigured: ADMIN_INITIAL_PASSWORD !== '123456',
      loginMaxAttempts: LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: LOGIN_LOCK_MINUTES,
      corsAllowAll: CORS_ALLOW_ALL
    },
    productionWarnings: warnings,
    checklist: [
      'Configurar domínio apontando para o servidor.',
      'Ativar HTTPS no proxy/host.',
      'Trocar ADMIN_INITIAL_PASSWORD no primeiro deploy.',
      'Configurar backups automáticos do banco no painel do Supabase.',
      'Testar cadastro, corrida, tempo real e mapa no domínio final.',
      'Revisar termos, privacidade e regras municipais antes da operação real.',
      'Configurar CORS_ORIGIN para permitir o app Android/Capacitor acessar a API.',
      'Definir a URL do backend online em public/mobile-config.js antes do build Android.'
    ]
  };
}

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  }, res.req));
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, securityHeaders({ 'Content-Type': contentType, ...headers }, res.req));
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function getAuthUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const row = await dbGet(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
  `, [tokenHash(token), nowIso()]);
  return rowToUser(row);
}

async function requireAuth(req, res, roles = []) {
  const user = await getAuthUser(req);
  if (!user) {
    send(res, 401, { ok: false, error: 'Faça login para continuar.' });
    return null;
  }
  if (user.status === 'blocked') {
    send(res, 403, { ok: false, error: 'Usuário bloqueado.' });
    return null;
  }
  if (roles.length && !roles.includes(user.role)) {
    send(res, 403, { ok: false, error: 'Acesso não permitido para este perfil.' });
    return null;
  }
  return user;
}

function requireApprovedDriver(user, res) {
  if (!user || user.role !== 'driver') return false;
  if (user.status === 'approved') return true;
  send(res, 403, { ok: false, error: 'Seu cadastro de motorista ainda está em análise. Aguarde aprovação do administrador.' });
  return false;
}


async function getAuthUserFromToken(token) {
  if (!token) return null;
  const row = await dbGet(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
  `, [tokenHash(token), nowIso()]);
  return rowToUser(row);
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify({ ...payload, sentAt: nowIso() })}\n\n`);
}

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

function calculateFare(distanceKm, minutes, rules = defaultTariffRules) {
  return FIXED_FARE_BRL;
}


function isValidLatLng(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

function roundCoord(value) {
  return Number(Number(value).toFixed(6));
}

function haversineDistanceKm(origin, destination) {
  if (!origin || !destination || !isValidLatLng(origin.lat, origin.lng) || !isValidLatLng(destination.lat, destination.lng)) return 0;
  const toRad = degree => degree * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(Number(destination.lat) - Number(origin.lat));
  const dLng = toRad(Number(destination.lng) - Number(origin.lng));
  const lat1 = toRad(Number(origin.lat));
  const lat2 = toRad(Number(destination.lat));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

function isWithinAllowedCity(lat, lng) {
  if (!isValidLatLng(lat, lng)) return false;
  const distance = haversineDistanceKm(
    { lat: Number(lat), lng: Number(lng) },
    { lat: MAP_DEFAULT_CENTER.lat, lng: MAP_DEFAULT_CENTER.lng }
  );
  return distance <= CITY_GEOFENCE_RADIUS_KM;
}

function assertCoordsWithinAllowedCity(origin, destination) {
  if (!origin || !destination) return;
  if (!isWithinAllowedCity(origin.lat, origin.lng) || !isWithinAllowedCity(destination.lat, destination.lng)) {
    const error = new Error('Atendimento restrito a Santa Rita do Pardo - MS. Ajuste origem e destino dentro da cidade.');
    error.statusCode = 400;
    throw error;
  }
}

function isSantaRitaAddress(item) {
  const address = item && typeof item === 'object' ? (item.address || {}) : {};
  const cityParts = [
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.county,
    address.state_district
  ].filter(Boolean).map(value => String(value).toLowerCase());

  const display = String(item?.display_name || '').toLowerCase();
  const cityMatch = cityParts.some(part => part.includes('santa rita do pardo') || part.includes('santa rita do rio pardo'));
  const displayMatch = display.includes('santa rita do pardo') || display.includes('santa rita do rio pardo');
  return cityMatch || displayMatch;
}

function estimateMinutesByDistance(distanceKm) {
  const safeDistance = Math.max(Number(distanceKm || 0), 0.1);
  const minutes = Math.ceil((safeDistance / CITY_AVERAGE_SPEED_KMH) * 60);
  return Math.max(minutes, 3);
}

async function fetchJsonWithTimeout(url, timeoutMs = MAP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PardoGo-MVP/0.6 contato-local'
      }
    });
    if (!response.ok) throw new Error(`Serviço de mapa respondeu ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const GEOCODE_VIEWBOX_DEGREES = 0.16;

function geocodeViewBox() {
  const { lat, lng } = MAP_DEFAULT_CENTER;
  const left = lng - GEOCODE_VIEWBOX_DEGREES;
  const right = lng + GEOCODE_VIEWBOX_DEGREES;
  const top = lat + GEOCODE_VIEWBOX_DEGREES;
  const bottom = lat - GEOCODE_VIEWBOX_DEGREES;
  return `${left},${top},${right},${bottom}`;
}

async function geocodeAddress(query) {
  const term = String(query || '').trim();
  if (!term) return [];
  const expanded = /santa rita/i.test(term) ? term : `${term}, Santa Rita do Pardo, Mato Grosso do Sul, Brasil`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&dedupe=1&countrycodes=br&viewbox=${encodeURIComponent(geocodeViewBox())}&bounded=1&q=${encodeURIComponent(expanded)}`;
  const results = await fetchJsonWithTimeout(url).catch(() => []);
  return results
    .filter(item => isSantaRitaAddress(item) && isWithinAllowedCity(item.lat, item.lon))
    .map(item => ({
      label: item.display_name,
      lat: roundCoord(item.lat),
      lng: roundCoord(item.lon),
      bbox: item.boundingbox || null,
      source: 'nominatim'
    }));
}

async function reverseGeocodeCoords(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null;
  if (!isWithinAllowedCity(lat, lng)) return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
  const data = await fetchJsonWithTimeout(url).catch(() => null);
  if (!data) return null;
  return {
    label: String(data.display_name || '').trim(),
    lat: roundCoord(data.lat ?? lat),
    lng: roundCoord(data.lon ?? lng),
    source: 'nominatim-reverse'
  };
}

async function calculateRoute(origin, destination) {
  assertCoordsWithinAllowedCity(origin, destination);
  const straightLineKm = haversineDistanceKm(origin, destination);
  if (!isValidLatLng(origin?.lat, origin?.lng) || !isValidLatLng(destination?.lat, destination?.lng)) {
    return {
      distanceKm: 0,
      minutes: 0,
      straightLineKm,
      source: 'manual',
      geometry: null,
      fallback: true
    };
  }

  const from = `${Number(origin.lng)},${Number(origin.lat)}`;
  const to = `${Number(destination.lng)},${Number(destination.lat)}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson&steps=false`;

  try {
    const data = await fetchJsonWithTimeout(url);
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('Rota não encontrada.');
    const distanceKm = Number((route.distance / 1000).toFixed(2));
    const minutes = Math.max(Math.ceil(route.duration / 60), 3);
    return {
      distanceKm,
      minutes,
      straightLineKm,
      source: 'osrm',
      geometry: route.geometry || null,
      fallback: false
    };
  } catch {
    const distanceKm = Number(Math.max(straightLineKm * 1.35, 0.5).toFixed(2));
    return {
      distanceKm,
      minutes: estimateMinutesByDistance(distanceKm),
      straightLineKm,
      source: 'haversine-fallback',
      geometry: {
        type: 'LineString',
        coordinates: [[Number(origin.lng), Number(origin.lat)], [Number(destination.lng), Number(destination.lat)]]
      },
      fallback: true
    };
  }
}

function coordsFromBody(body) {
  const origin = isValidLatLng(body.originLat, body.originLng)
    ? { lat: Number(body.originLat), lng: Number(body.originLng) }
    : null;
  const destination = isValidLatLng(body.destinationLat, body.destinationLng)
    ? { lat: Number(body.destinationLat), lng: Number(body.destinationLng) }
    : null;
  return { origin, destination };
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

async function audit(actorUserId, action, entityType, entityId, details) {
  try {
    await dbRun(`
      INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      actorUserId || null,
      action,
      entityType,
      entityId || null,
      details ? JSON.stringify(details) : null,
      nowIso()
    ]);
  } catch {
    // Auditoria não pode derrubar operação principal.
  }
}

function validateRequired(fields, body) {
  for (const field of fields) {
    if (!String(body[field] || '').trim()) return `Campo obrigatório: ${field}`;
  }
  return null;
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


function numericPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function phoneForWhatsapp(phone) {
  const digits = numericPhone(phone);
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
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


function getLegalContent() {
  return {
    version: '2026-06-29-etapa11',
    terms: {
      title: 'Termos de uso do PardoGo',
      summary: 'Uso responsável da plataforma local de intermediação de corridas, com regras para passageiro, motorista, cancelamento, contato e suporte.',
      items: [
        'O passageiro deve informar origem, destino, forma de pagamento e observações verdadeiras.',
        'O motorista deve manter dados do veículo, placa e documentos atualizados para análise administrativa.',
        'A plataforma registra eventos operacionais, corridas, cancelamentos, contatos, avaliações e suporte para segurança e auditoria.',
        'Corridas podem ser canceladas por passageiro, motorista ou administrador quando houver motivo operacional ou de segurança.',
        'Este MVP é uma base técnica e precisa de revisão jurídica antes do lançamento comercial.'
      ]
    },
    privacy: {
      title: 'Política de privacidade e LGPD',
      summary: 'Dados pessoais são usados para cadastro, login, corrida, localização, contato, suporte, segurança e auditoria.',
      items: [
        'Dados tratados: nome, telefone, senha criptografada, perfil, localização de corrida, histórico, contatos, avaliações e chamados.',
        'A localização é usada para calcular rota, estimar preço, exibir origem/destino e apoiar a operação da corrida.',
        'A senha não é salva em texto puro; o sistema usa hash criptográfico.',
        'O usuário deve poder solicitar correção ou exclusão de dados quando a operação real for publicada.',
        'Antes do lançamento, a empresa deve validar base legal, retenção de dados e canal oficial de atendimento LGPD.'
      ]
    }
  };
}

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

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/api/health') {
      try {
        const probe = await dbGet('SELECT 1 AS ok');
        if (!probe || Number(probe.ok) !== 1) throw new Error('probe_failed');
        return send(res, 200, {
          ok: true,
          app: 'PardoGo',
          version: APP_VERSION,
          environment: NODE_ENV,
          renderCommit: String(process.env.RENDER_GIT_COMMIT || '').trim().slice(0, 12) || null,
          renderBranch: String(process.env.RENDER_GIT_BRANCH || '').trim() || null,
          renderRepo: String(process.env.RENDER_GIT_REPO_SLUG || '').trim() || null,
          uptimeSeconds: Math.round(process.uptime()),
          baseUrl: APP_BASE_URL,
          realtimeClients: eventClients.size,
          database: 'postgresql',
          features: ['api', 'postgresql', 'secure-sessions', 'security-headers', 'rate-limit', 'production-healthcheck', 'deploy-ready', 'geolocation', 'leaflet-map', 'route-calculation', 'realtime-sse', 'ride-cancellation', 'ride-contact', 'ride-rating', 'quality-dashboard', 'support-tickets', 'safety-reports', 'driver-documents', 'legal-lgpd', 'pwa', 'capacitor-android', 'mobile-api-config', 'mobile-cors']
        });
      } catch {
        return send(res, 503, {
          ok: false,
          app: 'PardoGo',
          version: APP_VERSION,
          environment: NODE_ENV,
          uptimeSeconds: Math.round(process.uptime()),
          error: 'Serviço temporariamente indisponível.'
        });
      }
    }

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

    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req);
      const role = body.role === 'driver' ? 'driver' : 'passenger';
      const required = role === 'driver'
        ? ['name', 'phone', 'password', 'vehicle', 'plate']
        : ['name', 'phone', 'password'];
      const missing = validateRequired(required, body);
      if (missing) return send(res, 400, { ok: false, error: missing });
      const normalizedName = String(body.name || '').replace(/\s+/g, ' ').trim();
      if (normalizedName.length < 2) {
        return send(res, 400, { ok: false, error: 'Informe seu nome.' });
      }
      if (!isStrongPassword(body.password)) {
        return send(res, 400, { ok: false, error: 'A senha precisa ter no mínimo 6 caracteres, 1 letra maiúscula e 1 caractere especial.' });
      }
      if (!(body.acceptTerms === true || body.acceptTerms === 'on' || body.acceptTerms === 'true')) {
        return send(res, 400, { ok: false, error: 'É necessário aceitar os termos de uso.' });
      }
      if (!(body.acceptPrivacy === true || body.acceptPrivacy === 'on' || body.acceptPrivacy === 'true')) {
        return send(res, 400, { ok: false, error: 'É necessário aceitar a política de privacidade.' });
      }
      const phone = normalizePhone(body.phone);
      if (phone === ADMIN_INITIAL_PHONE) {
        return send(res, 400, { ok: false, error: 'Este identificador é reservado para o administrador.' });
      }
      if (!isValidPhone(phone)) {
        return send(res, 400, { ok: false, error: 'Informe um telefone válido com DDD.' });
      }
      if (await getUserByPhone(phone)) {
        return send(res, 409, { ok: false, error: 'Telefone já cadastrado.' });
      }
      const user = createUserObject({
        name: normalizedName,
        phone,
        password: body.password,
        role,
        vehicle: body.vehicle,
        plate: body.plate,
        cnhNumber: body.cnhNumber,
        vehicleModel: body.vehicleModel,
        vehicleColor: body.vehicleColor,
        documentStatus: role === 'driver' ? 'pending_review' : 'not_sent',
        termsAccepted: true,
        privacyAccepted: true
      });
      try {
        await insertUser(user);
      } catch (error) {
        // Em requisições concorrentes, o índice UNIQUE de telefone pode disparar aqui.
        if (isUniqueConstraintError(error) && (await getUserByPhone(phone))) {
          return send(res, 409, { ok: false, error: 'Telefone já cadastrado.' });
        }
        throw error;
      }
      return send(res, 201, {
        ok: true,
        message: role === 'driver' ? 'Motorista cadastrado. Aguarde aprovação do administrador.' : 'Passageiro cadastrado com sucesso.',
        user: await publicUser(user)
      });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      await cleanupSessions();
      const body = await parseBody(req);
      const missing = validateRequired(['phone', 'password'], body);
      if (missing) return send(res, 400, { ok: false, error: missing });
      const normalizedPhone = normalizePhone(body.phone);
      if (!isValidPhone(normalizedPhone)) {
        return send(res, 400, { ok: false, error: 'Informe um telefone válido com DDD.' });
      }
      const lockInfo = loginLockInfo(req, normalizedPhone);
      if (lockInfo?.locked) {
        return send(res, 429, {
          ok: false,
          error: `Muitas tentativas de login. Tente novamente em ${lockInfo.retryAfterSeconds}s.`
        }, { 'Retry-After': String(lockInfo.retryAfterSeconds) });
      }
      const user = await getUserByPhone(normalizedPhone);
      const passwordValid = user
        ? verifyPassword(body.password, user.passwordHash)
        : false;
      if (!user || !passwordValid) {
        noteLoginFailure(req, normalizedPhone);
        return send(res, 401, { ok: false, error: 'Telefone ou senha inválidos.' });
      }
      clearLoginFailures(req, normalizedPhone);
      if (user.role === 'admin' && user.phone !== ADMIN_INITIAL_PHONE) {
        return send(res, 403, { ok: false, error: 'Este acesso administrativo foi desativado.' });
      }
      if (user.status === 'blocked') {
        return send(res, 403, { ok: false, error: 'Usuário bloqueado.' });
      }
      const session = await createSession(user, req);
      return send(res, 200, {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: await publicUser(user),
        message: user.role === 'driver' && user.status !== 'approved'
          ? 'Login realizado. Seu cadastro de motorista ainda está em análise.'
          : 'Login realizado com sucesso.'
      });
    }

    if (method === 'POST' && pathname === '/api/auth/google') {
      await cleanupSessions();
      const body = await parseBody(req);
      const credential = String(body.credential || '').trim();
      if (!credential) return send(res, 400, { ok: false, error: 'Token Google não informado.' });

      const google = await verifyGoogleCredential(credential);
      const oauth = await getOAuthAccount('google', google.sub);

      let user = oauth ? await getUserById(oauth.user_id) : null;
      if (!user) {
        const role = body.role === 'driver' ? 'driver' : 'passenger';
        const created = createUserObject({
          name: google.name,
          phone: await generateOAuthPlaceholderPhone(),
          password: crypto.randomBytes(24).toString('hex'),
          role,
          status: role === 'driver' ? 'pending' : 'active',
          documentStatus: role === 'driver' ? 'pending_review' : 'not_sent',
          termsAccepted: true,
          privacyAccepted: true
        });
        await insertUser(created);
        await createOAuthAccount({ provider: 'google', providerUserId: google.sub, userId: created.id, email: google.email });
        user = created;
      }

      if (user.status === 'blocked') {
        return send(res, 403, { ok: false, error: 'Usuário bloqueado.' });
      }

      const session = await createSession(user, req);
      return send(res, 200, {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: await publicUser(user),
        message: user.role === 'driver' && user.status !== 'approved'
          ? 'Acesso com Google realizado. Seu cadastro de motorista ainda está em análise.'
          : 'Acesso com Google realizado com sucesso.'
      });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      await revokeSession(getBearerToken(req));
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/me') {
      const user = await requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { ok: true, user: await publicUser(user) });
    }

    if (method === 'GET' && pathname === '/api/config') {
      return send(res, 200, { ok: true, tariffRules: await getTariffRules(), fixedFare: FIXED_FARE_BRL, stats: await stats(), paymentMethods: PAYMENT_METHODS });
    }

    if (method === 'GET' && pathname === '/api/legal') {
      return send(res, 200, { ok: true, legal: getLegalContent() });
    }

    if (method === 'GET' && pathname === '/api/maps/default-center') {
      return send(res, 200, { ok: true, center: MAP_DEFAULT_CENTER, averageSpeedKmh: CITY_AVERAGE_SPEED_KMH });
    }

    if (method === 'GET' && pathname === '/api/maps/geocode') {
      const q = url.searchParams.get('q') || '';
      if (!q.trim()) return send(res, 400, { ok: false, error: 'Informe o endereço para buscar.' });
      const results = await geocodeAddress(q);
      if (!results.length) {
        return send(res, 400, { ok: false, error: 'Não encontramos esse endereço em Santa Rita do Pardo - MS. Tente o nome de uma rua/avenida ou toque no mapa para marcar o ponto exato.' });
      }
      return send(res, 200, { ok: true, query: q, results, fallbackCenter: MAP_DEFAULT_CENTER });
    }

    if (method === 'GET' && pathname === '/api/maps/reverse-geocode') {
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      if (!isValidLatLng(lat, lng)) {
        return send(res, 400, { ok: false, error: 'Latitude/longitude inválidas.' });
      }
      if (!isWithinAllowedCity(lat, lng)) {
        return send(res, 400, { ok: false, error: 'Atendimento restrito a Santa Rita do Pardo - MS.' });
      }
      const result = await reverseGeocodeCoords(lat, lng);
      if (!result) {
        return send(res, 400, { ok: false, error: 'Nao foi possivel validar este ponto dentro de Santa Rita do Pardo - MS.' });
      }
      return send(res, 200, { ok: true, result });
    }

    if (method === 'POST' && pathname === '/api/maps/route') {
      const body = await parseBody(req);
      const { origin, destination } = coordsFromBody(body);
      if (!origin || !destination) return send(res, 400, { ok: false, error: 'Origem e destino precisam ter latitude e longitude.' });
      assertCoordsWithinAllowedCity(origin, destination);
      const route = await calculateRoute(origin, destination);
      return send(res, 200, { ok: true, ...route });
    }

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

    if (method === 'POST' && pathname === '/api/support/tickets') {
      const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
      if (!user) return;
      const body = await parseBody(req);
      const missing = validateRequired(['subject', 'category', 'message'], body);
      if (missing) return send(res, 400, { ok: false, error: missing });
      const ticket = await createSupportTicket(user, body);
      await emitRealtime('support-update', { type: 'support-created', ticket }, client => client.role === 'admin' || client.userId === user.id);
      return send(res, 201, { ok: true, ticket });
    }

    if (method === 'GET' && pathname === '/api/support/tickets') {
      const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
      if (!user) return;
      return send(res, 200, { ok: true, tickets: await getSupportTickets(user) });
    }

    if (method === 'POST' && pathname === '/api/reports') {
      const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
      if (!user) return;
      const body = await parseBody(req);
      const missing = validateRequired(['reportedRole', 'category', 'description'], body);
      if (missing) return send(res, 400, { ok: false, error: missing });
      const report = await createRideReport(user, body);
      await emitRealtime('security-update', { type: 'report-created', report }, client => client.role === 'admin' || client.userId === user.id);
      return send(res, 201, { ok: true, report });
    }

    if (method === 'GET' && pathname === '/api/reports') {
      const user = await requireAuth(req, res, ['passenger', 'driver', 'admin']);
      if (!user) return;
      return send(res, 200, { ok: true, reports: await getRideReports(user) });
    }

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

    return send(res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return send(res, statusCode, { ok: false, error: error.message || 'Erro interno.' });
  }
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^([.][.][\/\\])+/, '');
  const absolute = path.join(PUBLIC_DIR, filePath);
  if (!absolute.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Acesso negado.');
  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    return sendText(res, 404, 'Arquivo não encontrado.');
  }
  const ext = path.extname(absolute).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png'
  };
  const cache = ext === '.html' ? 'no-store' : 'public, max-age=3600';
  sendText(res, 200, fs.readFileSync(absolute), types[ext] || 'application/octet-stream', { 'Cache-Control': cache });
}

async function closeDatabaseSafely() {
  if (isDbClosed) return;
  try {
    await closePool();
  } catch {
    // Sem acao: fechamento best effort.
  } finally {
    isDbClosed = true;
  }
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

function installGracefulShutdown(server) {
  const shutdown = signal => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Recebido ${signal}. Iniciando graceful shutdown...`);

    closeAllSseClients(signal);

    const hardStop = setTimeout(async () => {
      await closeDatabaseSafely();
      process.exit(1);
    }, 15000);
    hardStop.unref();

    server.close(async () => {
      clearTimeout(hardStop);
      await closeDatabaseSafely();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function createServer() {
  validateProductionConfig();
  await openDatabase();
  return http.createServer(async (req, res) => {
    res.req = req;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (isShuttingDown) {
      return send(res, 503, { ok: false, error: 'Servidor em desligamento. Tente novamente em instantes.' });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders({}, req));
      return res.end();
    }
    if (shouldRedirectCanonical(req)) {
      res.writeHead(308, securityHeaders({ Location: canonicalRedirectLocation(req) }, req));
      return res.end();
    }
    if (shouldRedirectHttps(req)) {
      res.writeHead(308, securityHeaders({ Location: `https://${req.headers.host}${req.url}` }, req));
      return res.end();
    }
    if (url.pathname.startsWith('/api/') && isRateLimited(req)) {
      return send(res, 429, { ok: false, error: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' });
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  });
}

if (require.main === module) {
  (async () => {
    const server = await createServer();
    installGracefulShutdown(server);
    server.listen(PORT, () => {
      console.log(`PardoGo Etapa 14 rodando em http://localhost:${PORT}`);
      console.log(`Ambiente: ${NODE_ENV} | Base URL: ${APP_BASE_URL}`);
      console.log('Banco: PostgreSQL (Supabase)');
      const warnings = validateProductionConfig();
      warnings.forEach(warning => console.warn(`Aviso de produção: ${warning}`));
    });
  })().catch(error => {
    console.error(`Falha ao iniciar o servidor: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createServer, calculateFare, defaultTariffRules, openDatabase, systemChecklist, APP_VERSION, closeDatabaseSafely };
