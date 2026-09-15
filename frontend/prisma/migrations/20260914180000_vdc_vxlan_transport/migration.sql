ALTER TABLE "vdcs" ADD COLUMN "vxlan_transport_mode" TEXT NOT NULL DEFAULT 'cluster';
ALTER TABLE "vdcs" ADD COLUMN "vxlan_peers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "vdcs" ADD COLUMN "vxlan_mtu" INTEGER;
ALTER TABLE "vdcs" ADD COLUMN "transport_vlan_id" INTEGER;
ALTER TABLE "vdcs" ADD COLUMN "transport_device" TEXT;
ALTER TABLE "vdcs" ADD COLUMN "transport_cidr" TEXT;
ALTER TABLE "vdcs" ADD COLUMN "transport_node_addresses" JSONB;
