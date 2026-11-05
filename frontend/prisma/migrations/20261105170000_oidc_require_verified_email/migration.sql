ALTER TABLE "oidc_config" ADD COLUMN "require_verified_email" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "oidc_config" ADD COLUMN "idp_verifies_email" BOOLEAN NOT NULL DEFAULT false;
UPDATE "oidc_config" SET "require_verified_email" = false;
