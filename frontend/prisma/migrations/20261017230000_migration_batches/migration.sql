CREATE TABLE "migration_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_by" TEXT,
    "source_connection_id" TEXT NOT NULL,
    "target_connection_id" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'running',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "migration_batches_status_idx" ON "migration_batches"("status");

CREATE INDEX "migration_batches_tenant_id_source_connection_id_idx" ON "migration_batches"("tenant_id", "source_connection_id");

ALTER TABLE "migration_jobs" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "migration_jobs" ADD COLUMN "batch_order" INTEGER;

CREATE INDEX "migration_jobs_batch_id_idx" ON "migration_jobs"("batch_id");

ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "migration_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
