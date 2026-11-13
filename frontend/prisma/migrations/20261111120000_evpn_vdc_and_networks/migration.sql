ALTER TABLE "vdcs" ADD COLUMN "evpn_zone_id" TEXT;
ALTER TABLE "tenant_networks" ADD COLUMN "evpn_zone_id" TEXT;

CREATE INDEX "vdcs_evpn_zone_id_idx" ON "vdcs"("evpn_zone_id");
CREATE INDEX "tenant_networks_evpn_zone_id_idx" ON "tenant_networks"("evpn_zone_id");

ALTER TABLE "vdcs" ADD CONSTRAINT "vdcs_evpn_zone_id_fkey" FOREIGN KEY ("evpn_zone_id") REFERENCES "sdn_evpn_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_networks" ADD CONSTRAINT "tenant_networks_evpn_zone_id_fkey" FOREIGN KEY ("evpn_zone_id") REFERENCES "sdn_evpn_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
