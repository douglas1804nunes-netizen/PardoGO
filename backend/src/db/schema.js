const { dbExec } = require('./pg');

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
      email TEXT DEFAULT '',
      birthdate TEXT,
      gender TEXT NOT NULL DEFAULT 'unspecified',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'passenger', 'driver')),
      status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'approved', 'blocked')),
      online INTEGER NOT NULL DEFAULT 0,
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

    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unspecified';

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

module.exports = {
  migrate
};
