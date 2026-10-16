-- Per-vDC usage history (#902): one row per vDC and per sampling period.
-- No foreign key on vdc_id: the history of a deleted vDC is kept until the
-- retention purges it, identified by the columns copied at sampling time.
CREATE TABLE "vdc_usage_history" (
    "id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "vdc_name" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "pve_pool_name" TEXT NOT NULL,
    "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_vcpus" INTEGER NOT NULL DEFAULT 0,
    "used_ram_mb" INTEGER NOT NULL DEFAULT 0,
    "used_storage_mb" INTEGER NOT NULL DEFAULT 0,
    "used_vms" INTEGER NOT NULL DEFAULT 0,
    "used_snapshots" INTEGER NOT NULL DEFAULT 0,
    "used_backups" INTEGER NOT NULL DEFAULT 0,
    "used_storage_by_storage" JSONB,

    CONSTRAINT "vdc_usage_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vdc_usage_history_vdc_id_sampled_at_idx" ON "vdc_usage_history"("vdc_id", "sampled_at");

CREATE INDEX "vdc_usage_history_sampled_at_idx" ON "vdc_usage_history"("sampled_at");

CREATE INDEX "vdc_usage_history_tenant_id_idx" ON "vdc_usage_history"("tenant_id");

-- Leader lease for periodic jobs shared by several frontends.
CREATE TABLE "scheduler_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("name")
);
