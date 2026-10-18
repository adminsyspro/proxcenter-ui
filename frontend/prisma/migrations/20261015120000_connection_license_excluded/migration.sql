-- A connection declared outside the license (roadmap#58): it stays visible
-- and readable, counts in no quota, and ProxCenter refuses every write to it.
ALTER TABLE "Connection" ADD COLUMN IF NOT EXISTS "license_excluded" BOOLEAN NOT NULL DEFAULT false;
