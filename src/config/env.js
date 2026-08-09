const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const envFilePath = path.join(projectRoot, '.env');

function loadEnvFile(filePath = envFilePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
    values[key] = value;
  }
  return values;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeList(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isValidUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return /^https?:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

function isWeakAdminPassword(value) {
  const raw = String(value || '');
  const normalized = raw.trim().toLowerCase();
  const blocked = new Set([
    '123456',
    '12345678',
    'admin',
    'password',
    'senha',
    'troque-essa-senha-forte',
    'troque essa senha',
    'changeme',
    'change-me'
  ]);
  if (!raw || blocked.has(normalized)) return true;
  // Minimo forte para producao: 10+, maiuscula, minuscula, numero e especial.
  return !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/.test(raw);
}

function isTemporaryDbPath(dbPath) {
  const normalized = String(dbPath || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/tmp/')
    || normalized.includes('/temp/')
    || normalized.includes('/var/tmp/')
    || normalized.endsWith('/tmp')
    || normalized.endsWith('/temp');
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isGenericPhonePlaceholder(phone) {
  const raw = String(phone || '').trim().toLowerCase();
  return ['admin', 'telefone', 'phone', 'user', 'usuario', 'test', 'teste'].includes(raw);
}

function parseCorsOrigins(value) {
  return normalizeList(value, []);
}

function isAllowedProductionCorsOrigin(origin) {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') return false;
    if (host === 'localhost') return true;
    if (host === '127.0.0.1') return false;
    return true;
  } catch {
    return false;
  }
}

function validateEnvConfig(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides
  };
  const NODE_ENV = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  const appBaseUrl = String(env.APP_BASE_URL || '').trim();
  const canonicalBaseUrl = String(env.CANONICAL_BASE_URL || '').trim();
  const dbPath = String(env.DB_PATH || '').trim();
  const adminPhoneRaw = String(env.ADMIN_INITIAL_PHONE || '').trim();
  const adminPhoneDigits = normalizePhoneDigits(adminPhoneRaw);
  const adminPassword = String(env.ADMIN_INITIAL_PASSWORD || '');
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGIN);
  const requireSecureEnv = parseBoolean(env.REQUIRE_SECURE_ENV, false);

  if (!appBaseUrl) {
    if (isProduction) errors.push('APP_BASE_URL é obrigatório em produção.');
  } else if (!isValidUrl(appBaseUrl)) {
    errors.push('APP_BASE_URL deve ser uma URL HTTP/HTTPS válida.');
  } else if (isProduction && !appBaseUrl.startsWith('https://')) {
    errors.push('APP_BASE_URL deve usar HTTPS em produção.');
  }

  if (!canonicalBaseUrl) {
    if (isProduction) errors.push('CANONICAL_BASE_URL é obrigatório em produção.');
  } else if (!isValidUrl(canonicalBaseUrl)) {
    errors.push('CANONICAL_BASE_URL deve ser uma URL HTTP/HTTPS válida.');
  } else if (isProduction && !canonicalBaseUrl.startsWith('https://')) {
    errors.push('CANONICAL_BASE_URL deve usar HTTPS em produção.');
  }

  if (!dbPath) {
    errors.push('DB_PATH é obrigatório.');
  } else if (isProduction && isTemporaryDbPath(dbPath)) {
    errors.push('DB_PATH não pode apontar para diretório temporário em produção.');
  }

  if (!adminPhoneRaw) {
    if (isProduction) errors.push('ADMIN_INITIAL_PHONE é obrigatório em produção.');
  } else if (isGenericPhonePlaceholder(adminPhoneRaw)) {
    if (isProduction) errors.push('ADMIN_INITIAL_PHONE não pode usar placeholder genérico em produção.');
    else warnings.push('ADMIN_INITIAL_PHONE usa placeholder genérico. Use um telefone real.');
  } else if (!/^\d{10,13}$/.test(adminPhoneDigits)) {
    errors.push('ADMIN_INITIAL_PHONE deve conter telefone válido com DDD (10-13 dígitos).');
  }

  if (!adminPassword) {
    if (isProduction) errors.push('ADMIN_INITIAL_PASSWORD é obrigatório em produção.');
  } else if (isProduction && isWeakAdminPassword(adminPassword)) {
    errors.push('ADMIN_INITIAL_PASSWORD é fraca ou padrão. Defina senha forte sem valores de exemplo.');
  }

  if (!env.CORS_ORIGIN || String(env.CORS_ORIGIN).trim() === '*') {
    if (isProduction) errors.push('CORS_ORIGIN deve ser definido e não pode ser * em produção.');
  }

  if (isProduction) {
    const invalidCors = corsOrigins.filter(origin => !isAllowedProductionCorsOrigin(origin));
    if (invalidCors.length) {
      errors.push(`CORS_ORIGIN contém origem inválida para produção: ${invalidCors.join(', ')}`);
    }
  }

  if (isProduction && !parseBoolean(env.FORCE_HTTPS, false)) {
    errors.push('FORCE_HTTPS=1 é obrigatório em produção.');
  }
  if (isProduction && !parseBoolean(env.TRUST_PROXY, false)) {
    errors.push('TRUST_PROXY=1 é obrigatório em produção.');
  }

  if (isProduction && !requireSecureEnv) {
    warnings.push('REQUIRE_SECURE_ENV=1 recomendado em produção para bloquear boot inseguro.');
  }

  if (errors.length) throw new Error(`Configuração insegura para produção: ${errors.join(' ')}`);
  return { errors, warnings, isProduction };
}

function getEnvConfig(overrides = {}) {
  loadEnvFile();
  const env = {
    ...process.env,
    ...overrides
  };
  const NODE_ENV = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = NODE_ENV === 'production';
  const APP_BASE_URL = String(env.APP_BASE_URL || 'https://pardogo-8yn0.onrender.com').trim();
  const CANONICAL_BASE_URL = String(env.CANONICAL_BASE_URL || APP_BASE_URL).trim();
  const DB_PATH = String(env.DB_PATH || path.join(projectRoot, 'data', 'pardogo.sqlite')).trim();
  const ADMIN_INITIAL_PHONE = String(
    env.ADMIN_INITIAL_PHONE ||
    (isProduction ? '' : '67990000000')
  ).trim();
  const ADMIN_INITIAL_PASSWORD = String(
    env.ADMIN_INITIAL_PASSWORD ||
    (isProduction ? '' : 'DevOnly#PardoGo1')
  ).trim();
  const CORS_ORIGIN = String(env.CORS_ORIGIN || '').trim();
  const SESSION_DAYS = toNumber(env.SESSION_DAYS, 7);
  const DRIVER_LOCATION_STALE_SECONDS = toNumber(env.DRIVER_LOCATION_STALE_SECONDS, 120);
  const PORT = toNumber(env.PORT, 5173);
  const FORCE_HTTPS = parseBoolean(env.FORCE_HTTPS, false);
  const TRUST_PROXY = parseBoolean(env.TRUST_PROXY, false);
  const REQUIRE_SECURE_ENV = parseBoolean(env.REQUIRE_SECURE_ENV, false);
  const RATE_LIMIT_WINDOW_MS = toNumber(env.RATE_LIMIT_WINDOW_MS, 60_000);
  const RATE_LIMIT_MAX = toNumber(env.RATE_LIMIT_MAX, 300);
  const LOGIN_MAX_ATTEMPTS = toNumber(env.LOGIN_MAX_ATTEMPTS, 5);
  const LOGIN_LOCK_MINUTES = toNumber(env.LOGIN_LOCK_MINUTES, 15);
  const CITY_GEOFENCE_RADIUS_KM = toNumber(env.CITY_GEOFENCE_RADIUS_KM, 55);
  const CITY_AVERAGE_SPEED_KMH = toNumber(env.CITY_AVERAGE_SPEED_KMH, 28);
  const MAP_TIMEOUT_MS = toNumber(env.MAP_TIMEOUT_MS, 5500);
  const SSE_PING_MS = toNumber(env.SSE_PING_MS, 25000);
  const SSE_TICKET_TTL_MS = toNumber(env.SSE_TICKET_TTL_MS, 60_000);
  const GOOGLE_CLIENT_ID = String(env.GOOGLE_CLIENT_ID || '').trim();
  const CORS_ALLOWED_ORIGINS = normalizeList(CORS_ORIGIN, [APP_BASE_URL]);
  return {
    NODE_ENV,
    isProduction,
    PORT,
    APP_BASE_URL,
    CANONICAL_BASE_URL,
    DB_PATH,
    ADMIN_INITIAL_PHONE,
    ADMIN_INITIAL_PASSWORD,
    SESSION_DAYS,
    DRIVER_LOCATION_STALE_SECONDS,
    FORCE_HTTPS,
    TRUST_PROXY,
    REQUIRE_SECURE_ENV,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_LOCK_MINUTES,
    CITY_GEOFENCE_RADIUS_KM,
    CITY_AVERAGE_SPEED_KMH,
    MAP_TIMEOUT_MS,
    SSE_PING_MS,
    SSE_TICKET_TTL_MS,
    GOOGLE_CLIENT_ID,
    CORS_ORIGIN,
    CORS_ALLOWED_ORIGINS,
    APP_BASE_ORIGIN: (() => { try { return new URL(APP_BASE_URL).origin; } catch { return ''; } })(),
    CANONICAL_BASE_ORIGIN: (() => { try { return new URL(CANONICAL_BASE_URL).origin; } catch { return ''; } })(),
    CANONICAL_HOST: (() => { try { return new URL(CANONICAL_BASE_URL).host; } catch { return ''; } })(),
    CANONICAL_REDIRECT_HOSTS: normalizeList(env.CANONICAL_REDIRECT_HOSTS || '', []),
    DEFAULT_CORS_ORIGINS: Array.from(new Set([
      (() => { try { return new URL(APP_BASE_URL).origin; } catch { return ''; } })(),
      (() => { try { return new URL(CANONICAL_BASE_URL).origin; } catch { return ''; } })(),
      'https://pardogo-8yn0.onrender.com'
    ].filter(Boolean)))
  };
}

const envConfig = getEnvConfig();

module.exports = {
  loadEnvFile,
  parseBoolean,
  validateEnvConfig,
  getEnvConfig,
  envConfig
};
