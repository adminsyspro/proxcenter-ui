ALTER TABLE IF EXISTS "replication_job_vm_status"
  ADD COLUMN IF NOT EXISTS "source_disks_json" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "pending_source_disks_json" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reseed_disks_json" TEXT NOT NULL DEFAULT '';
