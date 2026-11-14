ALTER TABLE "migration_jobs" ADD COLUMN "suggested_sync_interval_sec" INTEGER;
ALTER TABLE "migration_jobs" ADD COLUMN "sync_measure" JSONB;
