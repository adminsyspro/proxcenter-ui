-- Storage policies with per-disk QoS caps (#656 suggestion 2): named policies
-- per provider connection, assigned to vDCs with an optional per-policy quota.
-- One policy per (connection, storage): usage is measured per storage, two
-- policies on the same backend would make quota attribution ambiguous.

CREATE TABLE "storage_policies" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "storage_id" TEXT NOT NULL,
    "iops_rd" INTEGER,
    "iops_wr" INTEGER,
    "mbps_rd" INTEGER,
    "mbps_wr" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "storage_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storage_policies_connection_id_name_key"
  ON "storage_policies"("connection_id", "name");
CREATE UNIQUE INDEX "storage_policies_connection_id_storage_id_key"
  ON "storage_policies"("connection_id", "storage_id");
ALTER TABLE "storage_policies" ADD CONSTRAINT "storage_policies_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("connection_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "vdc_storage_policies" (
    "id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "quota_mb" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vdc_storage_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vdc_storage_policies_vdc_id_policy_id_key"
  ON "vdc_storage_policies"("vdc_id", "policy_id");
CREATE INDEX "vdc_storage_policies_vdc_id_idx" ON "vdc_storage_policies"("vdc_id");
ALTER TABLE "vdc_storage_policies" ADD CONSTRAINT "vdc_storage_policies_vdc_id_fkey"
  FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vdc_storage_policies" ADD CONSTRAINT "vdc_storage_policies_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "storage_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vdc_usage_cache" ADD COLUMN "used_storage_by_storage" JSONB;
