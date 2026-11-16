ALTER TABLE "Connection" ADD COLUMN "migrationCopyRateLimitPerHostMBps" INTEGER;
ALTER TABLE "migration_batches" ADD COLUMN "copy_rate_limit" JSONB;
ALTER TABLE "migration_jobs" ADD COLUMN "copy_active_at" TIMESTAMP(3);
CREATE INDEX "migration_jobs_copy_active_at_idx" ON "migration_jobs"("copy_active_at");
