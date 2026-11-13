CREATE TABLE "sdn_evpn_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "zone_name" TEXT NOT NULL,
    "vrf_vxlan" INTEGER NOT NULL,
    "mtu" INTEGER,
    "vni_start" INTEGER NOT NULL,
    "vni_end" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdn_evpn_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sdn_evpn_zone_members" (
    "id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "controller" TEXT NOT NULL,
    "controller_created" BOOLEAN NOT NULL DEFAULT false,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdn_evpn_zone_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sdn_evpn_zones_name_key" ON "sdn_evpn_zones"("name");
CREATE UNIQUE INDEX "sdn_evpn_zones_zone_name_key" ON "sdn_evpn_zones"("zone_name");
CREATE UNIQUE INDEX "sdn_evpn_zones_vrf_vxlan_key" ON "sdn_evpn_zones"("vrf_vxlan");
CREATE UNIQUE INDEX "sdn_evpn_zone_members_zone_id_connection_id_key" ON "sdn_evpn_zone_members"("zone_id", "connection_id");
CREATE INDEX "sdn_evpn_zone_members_connection_id_idx" ON "sdn_evpn_zone_members"("connection_id");

ALTER TABLE "sdn_evpn_zone_members" ADD CONSTRAINT "sdn_evpn_zone_members_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "sdn_evpn_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sdn_evpn_zone_members" ADD CONSTRAINT "sdn_evpn_zone_members_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
