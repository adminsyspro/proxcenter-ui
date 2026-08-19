-- VLANs for tenants (#646): per-vDC VLAN pools, shared per-bridge VLAN zones,
-- and a type discriminator on vdc_vnets. The vxlan_tag column is reused for
-- both VNIs (>= 10000) and VLAN tags (<= 4094); `type` disambiguates.

ALTER TABLE "vdc_vnets" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'vxlan';
ALTER TABLE "vdc_vnets" ADD COLUMN "bridge" TEXT;
ALTER TABLE "vdc_vnets" ADD COLUMN "zone_name" TEXT;

-- Backfill: every existing vnet lives in its vDC's VXLAN zone.
UPDATE "vdc_vnets" vn
SET "zone_name" = v."sdn_zone_name"
FROM "vdcs" v
WHERE v."id" = vn."vdc_id";

DROP INDEX "vdc_vnets_vdc_id_vxlan_tag_key";
CREATE UNIQUE INDEX "vdc_vnets_vdc_id_type_vxlan_tag_key"
  ON "vdc_vnets" ("vdc_id", "type", "vxlan_tag");

CREATE TABLE "vdc_vlan_pools" (
    "id" TEXT NOT NULL,
    "vdc_id" TEXT NOT NULL,
    "bridge" TEXT NOT NULL,
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vdc_vlan_pools_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vdc_vlan_pools_vdc_id_idx" ON "vdc_vlan_pools"("vdc_id");
ALTER TABLE "vdc_vlan_pools" ADD CONSTRAINT "vdc_vlan_pools_vdc_id_fkey"
  FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sdn_vlan_zones" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "bridge" TEXT NOT NULL,
    "zone_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sdn_vlan_zones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sdn_vlan_zones_connection_id_bridge_key"
  ON "sdn_vlan_zones"("connection_id", "bridge");
CREATE UNIQUE INDEX "sdn_vlan_zones_connection_id_zone_name_key"
  ON "sdn_vlan_zones"("connection_id", "zone_name");
ALTER TABLE "sdn_vlan_zones" ADD CONSTRAINT "sdn_vlan_zones_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
