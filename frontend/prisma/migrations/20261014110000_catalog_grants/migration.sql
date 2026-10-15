-- Blueprints get the provider "everyone" flag images already had.
ALTER TABLE "blueprints" ADD COLUMN "is_shared" BOOLEAN NOT NULL DEFAULT false;

-- Per-tenant / per-vDC grants on provider catalogue entries (images and
-- blueprints). Existing installs are unaffected: no row means the entry keeps
-- its isShared behaviour.
CREATE TABLE "catalog_grants" (
  "id" TEXT NOT NULL,
  "image_id" TEXT,
  "blueprint_id" TEXT,
  "grantee_tenant_id" TEXT,
  "vdc_id" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_grants_one_entry" CHECK (("image_id" IS NULL) <> ("blueprint_id" IS NULL)),
  CONSTRAINT "catalog_grants_one_grantee" CHECK (("grantee_tenant_id" IS NULL) <> ("vdc_id" IS NULL))
);

CREATE UNIQUE INDEX "catalog_grants_image_id_grantee_tenant_id_key" ON "catalog_grants"("image_id", "grantee_tenant_id");
CREATE UNIQUE INDEX "catalog_grants_image_id_vdc_id_key" ON "catalog_grants"("image_id", "vdc_id");
CREATE UNIQUE INDEX "catalog_grants_blueprint_id_grantee_tenant_id_key" ON "catalog_grants"("blueprint_id", "grantee_tenant_id");
CREATE UNIQUE INDEX "catalog_grants_blueprint_id_vdc_id_key" ON "catalog_grants"("blueprint_id", "vdc_id");
CREATE INDEX "catalog_grants_grantee_tenant_id_idx" ON "catalog_grants"("grantee_tenant_id");
CREATE INDEX "catalog_grants_vdc_id_idx" ON "catalog_grants"("vdc_id");

ALTER TABLE "catalog_grants" ADD CONSTRAINT "catalog_grants_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "custom_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_grants" ADD CONSTRAINT "catalog_grants_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_grants" ADD CONSTRAINT "catalog_grants_grantee_tenant_id_fkey" FOREIGN KEY ("grantee_tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_grants" ADD CONSTRAINT "catalog_grants_vdc_id_fkey" FOREIGN KEY ("vdc_id") REFERENCES "vdcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
