const { NODE_ENV, FORCE_HTTPS, TRUST_PROXY, CANONICAL_BASE_ORIGIN, CANONICAL_HOST, CANONICAL_REDIRECT_HOSTS, CORS_ALLOW_ALL, CORS_ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } = require('../config');

const rateLimitBuckets = new Map();

const loginAttemptBuckets = new Map();

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
      "script-src 'self' https://unpkg.com",
      "script-src-elem 'self' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      connectSrc,
      "frame-src 'self'",
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

module.exports = {
  securityHeaders,
  clearLoginFailures,
  noteLoginFailure,
  loginLockInfo,
  isRateLimited,
  shouldRedirectHttps,
  shouldRedirectCanonical,
  canonicalRedirectLocation
};
