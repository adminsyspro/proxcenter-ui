-- CreateTable
CREATE TABLE "tenant_networks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pve_name" TEXT NOT NULL,
    "vni" INTEGER NOT NULL,
    "mtu" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_network_members" (
    "id" TEXT NOT NULL,
    "tenant_network_id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "vnet_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_network_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_networks_vni_key" ON "tenant_networks"("vni");

-- CreateIndex
CREATE INDEX "tenant_networks_tenant_id_idx" ON "tenant_networks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_networks_tenant_id_name_key" ON "tenant_networks"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_network_members_vnet_id_key" ON "tenant_network_members"("vnet_id");

-- CreateIndex
CREATE INDEX "tenant_network_members_vdc_id_idx" ON "tenant_network_members"("vdc_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_network_members_tenant_network_id_vdc_id_key" ON "tenant_network_members"("tenant_network_id", "vdc_id");

-- AddForeignKey
ALTER TABLE "tenant_networks" ADD CONSTRAINT "tenant_networks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_network_members" ADD CONSTRAINT "tenant_network_members_tenant_network_id_fkey" FOREIGN KEY ("tenant_network_id") REFERENCES "tenant_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_network_members" ADD CONSTRAINT "tenant_network_members_vdc_id_fkey" FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_network_members" ADD CONSTRAINT "tenant_network_members_vnet_id_fkey" FOREIGN KEY ("vnet_id") REFERENCES "vdc_vnets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

