-- Durable operator decisions for a running migration (cutover, hard power off, root choice).
ALTER TABLE "migration_jobs" ADD COLUMN "cutover_requested_at" TIMESTAMP(3);
ALTER TABLE "migration_jobs" ADD COLUMN "force_poweroff_requested_at" TIMESTAMP(3);
ALTER TABLE "migration_jobs" ADD COLUMN "root_choice" TEXT;
