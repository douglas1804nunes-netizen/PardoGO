const crypto = require('crypto');
const { dbRun } = require('../db/pg');
const { nowIso } = require('../utils/validation');

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

module.exports = {
  audit
};
