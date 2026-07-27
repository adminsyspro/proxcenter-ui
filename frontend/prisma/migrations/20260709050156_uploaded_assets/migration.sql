-- DropForeignKey
ALTER TABLE "license_mappings" DROP CONSTRAINT "license_mappings_connection_id_fkey";

-- DropForeignKey
ALTER TABLE "license_mappings" DROP CONSTRAINT "license_mappings_license_id_fkey";

-- DropForeignKey
ALTER TABLE "provider_connections" DROP CONSTRAINT "provider_connections_connection_id_fkey";

-- DropForeignKey
ALTER TABLE "vdcs" DROP CONSTRAINT "vdcs_connection_id_fkey";

-- DropIndex
DROP INDEX "rbac_roles_name_key";

-- CreateTable
CREATE TABLE "uploaded_assets" (
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_assets_pkey" PRIMARY KEY ("tenant_id","kind","slot")
);

-- AddForeignKey
ALTER TABLE "vdcs" ADD CONSTRAINT "vdcs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("connection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_mappings" ADD CONSTRAINT "license_mappings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_mappings" ADD CONSTRAINT "license_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "DashboardLayout_tenantId_userId_name_key" RENAME TO "DashboardLayout_tenant_id_userId_name_key";
