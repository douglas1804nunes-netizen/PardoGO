const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);

// pbkdf2 assíncrono roda no threadpool do libuv e não trava o event loop durante login/cadastro.
async function derivePasswordHash(password, salt, iterations) {
  return (await pbkdf2(String(password), salt, iterations, 32, 'sha256')).toString('hex');
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = 180000) {
  const hash = await derivePasswordHash(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;

  // Compatibilidade com hashes das etapas antigas: salt:hash.
  if (stored.includes(':') && !stored.startsWith('pbkdf2_')) {
    const [salt, hash] = stored.split(':');
    const candidate = await derivePasswordHash(password, salt, 120000);
    return safeEqual(hash, candidate);
  }

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const hash = parts[3];
  const candidate = await derivePasswordHash(password, salt, iterations);
  return safeEqual(hash, candidate);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  hashPassword,
  verifyPassword
};
