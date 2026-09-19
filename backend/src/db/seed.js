const { dbGet, dbAll, dbRun } = require('./pg');
const { APP_VERSION, ADMIN_INITIAL_PHONE, ADMIN_INITIAL_PASSWORD, defaultTariffRules } = require('../config');
const { audit } = require('../services/audit');
const { hashPassword } = require('../services/password');
const { createUserObject, insertUser } = require('../services/users');

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
    const adminUser = await createUserObject({
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
    `, [await hashPassword(ADMIN_INITIAL_PASSWORD), now, admin.id]);
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

module.exports = {
  seed
};
