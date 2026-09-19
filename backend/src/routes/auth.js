const { dbRun, isUniqueConstraintError } = require('../db/pg');
const { ADMIN_INITIAL_PHONE, MIN_USER_AGE_YEARS } = require('../config');
const { getBearerToken, requireAuth } = require('../http/auth');
const { send, parseBody } = require('../http/response');
const { clearLoginFailures, noteLoginFailure, loginLockInfo } = require('../http/security');
const { audit } = require('../services/audit');
const { hashPassword, verifyPassword } = require('../services/password');
const { createSession, revokeSession, cleanupSessions } = require('../services/sessions');
const { createUserObject, insertUser, publicUser, getUserByPhone, getUserById } = require('../services/users');
const { nowIso, normalizePhone, isValidPhone, isStrongPassword, isValidEmail, isValidGender, isValidBirthdate, validateRequired } = require('../utils/validation');
const { NOT_HANDLED } = require('../http/not-handled');

async function handle(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await parseBody(req);
    const role = body.role === 'driver' ? 'driver' : 'passenger';
    const required = role === 'driver'
      ? ['name', 'phone', 'password', 'vehicle', 'plate', 'birthdate', 'gender']
      : ['name', 'phone', 'password', 'birthdate', 'gender'];
    const missing = validateRequired(required, body);
    if (missing) return send(res, 400, { ok: false, error: missing });
    const normalizedName = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (normalizedName.length < 2) {
      return send(res, 400, { ok: false, error: 'Informe seu nome.' });
    }
    if (!isStrongPassword(body.password)) {
      return send(res, 400, { ok: false, error: 'A senha precisa ter no mínimo 6 caracteres, 1 letra maiúscula e 1 caractere especial.' });
    }
    if (!isValidBirthdate(body.birthdate)) {
      return send(res, 400, { ok: false, error: `Informe uma data de nascimento válida (idade mínima de ${MIN_USER_AGE_YEARS} anos).` });
    }
    if (!isValidGender(body.gender)) {
      return send(res, 400, { ok: false, error: 'Selecione uma opção de sexo.' });
    }
    if (body.email && !isValidEmail(body.email)) {
      return send(res, 400, { ok: false, error: 'Informe um e-mail válido.' });
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
    const user = await createUserObject({
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
      privacyAccepted: true,
      email: body.email,
      birthdate: body.birthdate,
      gender: body.gender
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
      ? await verifyPassword(body.password, user.passwordHash)
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

  if (method === 'POST' && pathname === '/api/auth/logout') {
    await revokeSession(getBearerToken(req));
    return send(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = await requireAuth(req, res);
    if (!user) return;
    return send(res, 200, { ok: true, user: await publicUser(user) });
  }

  if (method === 'PATCH' && pathname === '/api/me') {
    const user = await requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);

    const nextName = body.name !== undefined
      ? String(body.name || '').replace(/\s+/g, ' ').trim()
      : user.name;
    if (nextName.length < 2) {
      return send(res, 400, { ok: false, error: 'Informe seu nome.' });
    }

    const nextPhone = body.phone !== undefined ? normalizePhone(body.phone) : user.phone;
    if (!isValidPhone(nextPhone)) {
      return send(res, 400, { ok: false, error: 'Informe um telefone válido com DDD.' });
    }
    if (nextPhone !== user.phone) {
      if (nextPhone === ADMIN_INITIAL_PHONE) {
        return send(res, 400, { ok: false, error: 'Este identificador é reservado para o administrador.' });
      }
      const existing = await getUserByPhone(nextPhone);
      if (existing && existing.id !== user.id) {
        return send(res, 409, { ok: false, error: 'Telefone já cadastrado.' });
      }
    }

    const nextEmail = body.email !== undefined ? String(body.email || '').trim().toLowerCase() : (user.email || '');
    if (nextEmail && !isValidEmail(nextEmail)) {
      return send(res, 400, { ok: false, error: 'Informe um e-mail válido.' });
    }

    const nextBirthdate = body.birthdate !== undefined ? body.birthdate : user.birthdate;
    if (body.birthdate !== undefined && !isValidBirthdate(nextBirthdate)) {
      return send(res, 400, { ok: false, error: `Informe uma data de nascimento válida (idade mínima de ${MIN_USER_AGE_YEARS} anos).` });
    }

    const nextGender = body.gender !== undefined ? body.gender : user.gender;
    if (body.gender !== undefined && !isValidGender(nextGender)) {
      return send(res, 400, { ok: false, error: 'Selecione uma opção de sexo válida.' });
    }

    let nextPasswordHash = user.passwordHash;
    if (body.newPassword) {
      if (!(await verifyPassword(String(body.currentPassword || ''), user.passwordHash))) {
        return send(res, 401, { ok: false, error: 'Senha atual incorreta.' });
      }
      if (!isStrongPassword(body.newPassword)) {
        return send(res, 400, { ok: false, error: 'A nova senha precisa ter no mínimo 6 caracteres, 1 letra maiúscula e 1 caractere especial.' });
      }
      nextPasswordHash = await hashPassword(body.newPassword);
    }

    const updatedAt = nowIso();
    await dbRun(`
      UPDATE users
      SET name = ?, phone = ?, email = ?, birthdate = ?, gender = ?, password_hash = ?, updated_at = ?
      WHERE id = ?
    `, [nextName, nextPhone, nextEmail, nextBirthdate || null, nextGender, nextPasswordHash, updatedAt, user.id]);

    await audit(user.id, 'update_profile', 'user', user.id, {
      phoneChanged: nextPhone !== user.phone,
      emailChanged: nextEmail !== (user.email || ''),
      passwordChanged: nextPasswordHash !== user.passwordHash
    });

    const updatedUser = await getUserById(user.id);
    return send(res, 200, { ok: true, user: await publicUser(updatedUser), message: 'Dados atualizados com sucesso.' });
  }

  return NOT_HANDLED;
}

module.exports = { handle };
