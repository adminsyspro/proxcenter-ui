ALTER TABLE "migration_jobs" ADD COLUMN "test_request" JSONB;
ALTER TABLE "migration_jobs" ADD COLUMN "test_stop_requested_at" TIMESTAMP(3);
ALTER TABLE "migration_jobs" ADD COLUMN "test_state" JSONB;
