-- Partner of the connected license and its logo (roadmap#22, partner pairing).
-- The orchestrator runs this same statement at startup, hence IF NOT EXISTS.
ALTER TABLE "license_connection" ADD COLUMN IF NOT EXISTS partner_name TEXT, ADD COLUMN IF NOT EXISTS partner_logo BYTEA, ADD COLUMN IF NOT EXISTS partner_logo_type TEXT, ADD COLUMN IF NOT EXISTS partner_logo_sha256 TEXT;
