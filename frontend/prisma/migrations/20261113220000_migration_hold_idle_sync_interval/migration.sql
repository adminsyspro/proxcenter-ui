ALTER TABLE "migration_jobs" ADD COLUMN "hold_idle_at" TIMESTAMP(3);
ALTER TABLE "Connection" ADD COLUMN "migrationSyncIntervalSec" INTEGER;
