-- Add live cutover-downtime estimate to migration jobs (warm interactive cutover).
ALTER TABLE "migration_jobs" ADD COLUMN "projected_downtime_sec" INTEGER;
