-- Check-in token for the connected license (roadmap#22, lot 4 wave 2). The
-- orchestrator runs this same statement at startup, hence IF NOT EXISTS.
ALTER TABLE "license_connection" ADD COLUMN IF NOT EXISTS checkin_token TEXT NOT NULL DEFAULT '';
