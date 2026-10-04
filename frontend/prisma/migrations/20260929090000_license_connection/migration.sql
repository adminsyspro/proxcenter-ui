-- Portal connection state of this install (roadmap#22, lot 4). The
-- orchestrator creates the same table at startup when this migration has not
-- run yet, hence IF NOT EXISTS; keep both DDLs identical.
CREATE TABLE IF NOT EXISTS "license_connection" (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  portal_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'none',
  instance_id TEXT,
  instance_name TEXT,
  customer_name TEXT,
  device_code TEXT,
  user_code TEXT,
  verification_url TEXT,
  pairing_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  last_checkin_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  next_checkin_at TIMESTAMPTZ,
  checkin_seq BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  server_skew_seconds INTEGER NOT NULL DEFAULT 0,
  held JSONB NOT NULL DEFAULT '[]',
  revoked_ids JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
