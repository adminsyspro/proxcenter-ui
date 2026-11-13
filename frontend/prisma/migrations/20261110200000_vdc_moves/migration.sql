CREATE TABLE "vdc_moves" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "guest_name" TEXT,
    "vmid" INTEGER NOT NULL,
    "target_vmid" INTEGER NOT NULL,
    "source_connection_id" TEXT NOT NULL,
    "source_node" TEXT NOT NULL,
    "source_vdc_id" TEXT NOT NULL,
    "target_connection_id" TEXT NOT NULL,
    "target_node" TEXT NOT NULL,
    "target_vdc_id" TEXT NOT NULL,
    "storage_map" JSONB NOT NULL,
    "bridge_map" JSONB NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "delete_source" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'tenant',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "upid" TEXT,
    "error" TEXT,
    "warnings" JSONB,
    "requested_by" TEXT,
    "holder" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "vdc_moves_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vdc_moves_tenant_id_status_idx" ON "vdc_moves"("tenant_id", "status");

CREATE INDEX "vdc_moves_status_heartbeat_at_idx" ON "vdc_moves"("status", "heartbeat_at");

INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('vm.move_vdc', 'vm.move_vdc', 'vm', 'Move a VM to another vDC of the same tenant', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.id IN ('role_super_admin', 'role_provider_admin', 'role_tenant_admin') AND p.id = 'vm.move_vdc'
ON CONFLICT DO NOTHING;
