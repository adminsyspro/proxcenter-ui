-- Jobs restoring files from a PBS backup into a running guest (agent or SSH).
-- Progress and the last log lines are mirrored on the row for the dialog to
-- poll; credentials are never stored.
CREATE TABLE "guest_file_restore_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "connection_id" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "guest_type" TEXT NOT NULL,
    "guest_name" TEXT,
    "source" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "method" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "conflict" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "guest_os" TEXT,
    "bytes_done" BIGINT NOT NULL DEFAULT 0,
    "bytes_total" BIGINT,
    "files_done" INTEGER NOT NULL DEFAULT 0,
    "files_skipped" INTEGER NOT NULL DEFAULT 0,
    "files_failed" INTEGER NOT NULL DEFAULT 0,
    "current_path" TEXT,
    "error" TEXT,
    "log" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_file_restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_file_restore_jobs_tenant_id_created_at_idx" ON "guest_file_restore_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "guest_file_restore_jobs_connection_id_vmid_idx" ON "guest_file_restore_jobs"("connection_id", "vmid");
