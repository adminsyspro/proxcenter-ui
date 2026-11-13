CREATE TABLE "gpu_usage_hours" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "connection_id" TEXT NOT NULL,
    "connection_name" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "vm_name" TEXT NOT NULL,
    "device_key" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "mdev" TEXT,
    "pool" TEXT,
    "vdc_id" TEXT,
    "vdc_name" TEXT,
    "tenant_id" TEXT,
    "tenant_name" TEXT,
    "running_seconds" INTEGER NOT NULL DEFAULT 0,
    "reserved_seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gpu_usage_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gpu_usage_hours_hour_connection_id_vmid_device_key_key" ON "gpu_usage_hours"("hour", "connection_id", "vmid", "device_key");
CREATE INDEX "gpu_usage_hours_hour_idx" ON "gpu_usage_hours"("hour");
CREATE INDEX "gpu_usage_hours_tenant_id_hour_idx" ON "gpu_usage_hours"("tenant_id", "hour");

CREATE TABLE "vdc_gpu_quotas" (
    "id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vdc_gpu_quotas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vdc_gpu_quotas_vdc_id_kind_model_key_profile_name_key" ON "vdc_gpu_quotas"("vdc_id", "kind", "model_key", "profile_name");

ALTER TABLE "vdc_gpu_quotas" ADD CONSTRAINT "vdc_gpu_quotas_vdc_id_fkey" FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
