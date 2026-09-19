const { dbGet } = require('../db/pg');
const { send } = require('./response');
const { tokenHash } = require('../services/sessions');
const { rowToUser } = require('../services/users');
const { nowIso } = require('../utils/validation');

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

module.exports = {
  getBearerToken,
  requireAuth,
  requireApprovedDriver,
  getAuthUserFromToken
};
