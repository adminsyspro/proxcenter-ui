-- Transport VNI policy (roadmap#18): shared transport with a provider-assigned
-- VNI range per vDC, or a transport dedicated to the tenant who then picks
-- freely. L3 edge model (#904): who provides gateway, DHCP and NAT.
ALTER TABLE "vdcs" ADD COLUMN "transport_sharing" TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE "vdcs" ADD COLUMN "vni_range_start" INTEGER;
ALTER TABLE "vdcs" ADD COLUMN "vni_range_end" INTEGER;
ALTER TABLE "vdcs" ADD COLUMN "edge_model" TEXT NOT NULL DEFAULT 'tenant';

ALTER TABLE "vdcs" ADD CONSTRAINT "vdcs_transport_sharing_check"
  CHECK ("transport_sharing" IN ('shared', 'dedicated'));
ALTER TABLE "vdcs" ADD CONSTRAINT "vdcs_edge_model_check"
  CHECK ("edge_model" IN ('tenant', 'platform'));
-- Both bounds or none, inside the 24-bit VNI space, ordered.
ALTER TABLE "vdcs" ADD CONSTRAINT "vdcs_vni_range_check"
  CHECK (
    (("vni_range_start" IS NULL) = ("vni_range_end" IS NULL))
    AND ("vni_range_start" IS NULL OR ("vni_range_start" >= 1 AND "vni_range_end" <= 16777215 AND "vni_range_start" <= "vni_range_end"))
  );
