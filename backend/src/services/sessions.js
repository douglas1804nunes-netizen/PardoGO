const crypto = require('crypto');
const { dbRun } = require('../db/pg');
const { SESSION_DAYS } = require('../config');
const { audit } = require('./audit');
const { nowIso } = require('../utils/validation');

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

module.exports = {
  tokenHash,
  createSession,
  revokeSession,
  cleanupSessions
};
