-- Optional per-tenant VMID range (MSP tenants only): new guests created
-- through ProxCenter must take a VMID inside [vmid_range_start, vmid_range_end].
ALTER TABLE "tenants" ADD COLUMN "vmid_range_start" INTEGER;
ALTER TABLE "tenants" ADD COLUMN "vmid_range_end" INTEGER;
