-- AlterTable: add SSO-only login behavior flags to oidc_config
-- show_local_login=true preserves the current behavior (local form visible) for existing rows.
ALTER TABLE "oidc_config" ADD COLUMN "show_local_login" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "oidc_config" ADD COLUMN "force_sso_redirect" BOOLEAN NOT NULL DEFAULT false;
