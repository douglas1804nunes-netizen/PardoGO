const path = require('path');
const { getEnvConfig, validateEnvConfig } = require('./env');

const envConfig = getEnvConfig();
validateEnvConfig(envConfig);

const APP_VERSION = '1.4.0';

const NODE_ENV = envConfig.NODE_ENV;

const PORT = Number(envConfig.PORT || 5173);

const DATABASE_URL = envConfig.DATABASE_URL;

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'frontend');

const APP_BASE_URL = envConfig.APP_BASE_URL;

const CANONICAL_BASE_URL = envConfig.CANONICAL_BASE_URL || envConfig.APP_BASE_URL;

const SESSION_DAYS = Number(envConfig.SESSION_DAYS || 7);

const ADMIN_LEGACY_ALIAS = 'admin';

const ADMIN_INITIAL_PHONE_RAW = String(envConfig.ADMIN_INITIAL_PHONE || '').trim().toLowerCase();

const ADMIN_INITIAL_PHONE = ADMIN_INITIAL_PHONE_RAW === ADMIN_LEGACY_ALIAS
  ? ADMIN_LEGACY_ALIAS
  : ADMIN_INITIAL_PHONE_RAW.replace(/\D/g, '');

const ADMIN_INITIAL_PASSWORD = String(envConfig.ADMIN_INITIAL_PASSWORD || '');

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

const LOGIN_MAX_ATTEMPTS = Number(envConfig.LOGIN_MAX_ATTEMPTS || 5);

const LOGIN_LOCK_MINUTES = Number(envConfig.LOGIN_LOCK_MINUTES || 15);

const MAP_DEFAULT_CENTER = { lat: -21.302, lng: -52.833, label: 'Santa Rita do Pardo - MS' };

const CITY_GEOFENCE_RADIUS_KM = Number(envConfig.CITY_GEOFENCE_RADIUS_KM || 55);

const CITY_AVERAGE_SPEED_KMH = Number(envConfig.CITY_AVERAGE_SPEED_KMH || 28);

const MAP_TIMEOUT_MS = Number(envConfig.MAP_TIMEOUT_MS || 5500);

const SSE_PING_MS = Number(envConfig.SSE_PING_MS || 25000);

const SSE_TICKET_TTL_MS = Number(envConfig.SSE_TICKET_TTL_MS || 60_000);

const PAYMENT_METHODS = ['Pix', 'Dinheiro'];

const GENDER_OPTIONS = ['female', 'male', 'other', 'unspecified'];

const MIN_USER_AGE_YEARS = 16;

const FIXED_FARE_BRL = 20;

const defaultTariffRules = {
  base: 5,
  perKm: 3.2,
  perMin: 0.45,
  min: 12,
  driverSharePercent: 80,
  city: 'Santa Rita do Pardo - MS'
};

module.exports = {
  envConfig,
  APP_VERSION,
  NODE_ENV,
  PORT,
  DATABASE_URL,
  PUBLIC_DIR,
  APP_BASE_URL,
  SESSION_DAYS,
  ADMIN_INITIAL_PHONE,
  ADMIN_INITIAL_PASSWORD,
  FORCE_HTTPS,
  TRUST_PROXY,
  REQUIRE_SECURE_ENV,
  CANONICAL_BASE_ORIGIN,
  CANONICAL_HOST,
  CANONICAL_REDIRECT_HOSTS,
  CORS_ALLOW_ALL,
  CORS_ALLOWED_ORIGINS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
  MAP_DEFAULT_CENTER,
  CITY_GEOFENCE_RADIUS_KM,
  CITY_AVERAGE_SPEED_KMH,
  MAP_TIMEOUT_MS,
  SSE_PING_MS,
  SSE_TICKET_TTL_MS,
  PAYMENT_METHODS,
  GENDER_OPTIONS,
  MIN_USER_AGE_YEARS,
  FIXED_FARE_BRL,
  defaultTariffRules
};
