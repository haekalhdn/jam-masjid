CREATE TABLE IF NOT EXISTS admin_invites (
  code_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
