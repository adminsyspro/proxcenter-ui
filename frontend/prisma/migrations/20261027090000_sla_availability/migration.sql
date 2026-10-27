-- Availability SLA: policies and maintenance windows.

CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "guests" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_maintenance_windows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "scope" TEXT NOT NULL,
    "connection_id" TEXT,
    "node" TEXT,
    "vmid" INTEGER,
    "policy_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_maintenance_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sla_policies_tenant_id_idx" ON "sla_policies"("tenant_id");
CREATE UNIQUE INDEX "sla_policies_tenant_id_name_key" ON "sla_policies"("tenant_id", "name");
CREATE INDEX "sla_maintenance_windows_tenant_id_starts_at_idx" ON "sla_maintenance_windows"("tenant_id", "starts_at");
