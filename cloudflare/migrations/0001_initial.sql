CREATE TABLE IF NOT EXISTS admins (
  telegram_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('poster', 'youtube')),
  title TEXT,
  media_key TEXT,
  youtube_id TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slides_active_order
ON slides(active, sort_order, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  telegram_user_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_invites (
  code_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings(key, value)
VALUES (
  'ticker',
  ''
);

INSERT OR IGNORE INTO settings(key, value)
VALUES ('iqamah_delays', '{"Subuh":7,"Dzuhur":7,"Ashar":7,"Maghrib":7,"Isya":7}');

INSERT OR IGNORE INTO settings(key, value)
VALUES ('prayer_durations', '{"Subuh":10,"Dzuhur":10,"Ashar":10,"Maghrib":10,"Isya":10,"Jumat":40}');

INSERT OR IGNORE INTO settings(key, value)
VALUES ('friday_settings', '{"theme":"Akan diumumkan","khatib":"Akan diumumkan","imam":"Akan diumumkan"}');
