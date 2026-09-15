-- AlterTable
ALTER TABLE "vdc_subnets" ADD COLUMN     "tenant_network_id" TEXT,
ALTER COLUMN "vnet_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "vdc_subnets_tenant_network_id_key" ON "vdc_subnets"("tenant_network_id");

-- AddForeignKey
ALTER TABLE "vdc_subnets" ADD CONSTRAINT "vdc_subnets_tenant_network_id_fkey" FOREIGN KEY ("tenant_network_id") REFERENCES "tenant_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner: a VNet's own subnet, or the canonical subnet of a
-- stretched tenant network (#901).
ALTER TABLE "vdc_subnets" ADD CONSTRAINT "vdc_subnets_one_owner_check" CHECK (("vnet_id" IS NOT NULL) <> ("tenant_network_id" IS NOT NULL));
