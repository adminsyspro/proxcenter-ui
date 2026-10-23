ALTER TABLE "oidc_config" ADD COLUMN "proxy_url" TEXT;
ALTER TABLE "oidc_config" ADD COLUMN "proxy_username" TEXT;
ALTER TABLE "oidc_config" ADD COLUMN "proxy_password_enc" TEXT;
ALTER TABLE "oidc_config" ADD COLUMN "proxy_bypass" TEXT;
