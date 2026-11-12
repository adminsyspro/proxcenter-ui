-- Per-tenant OIDC connections (issue #1289).

ALTER TABLE "users" ADD COLUMN "oidc_connection_id" TEXT;

UPDATE "users" SET "oidc_connection_id" = 'default' WHERE "oidc_sub" IS NOT NULL;

UPDATE "users" u SET "oidc_connection_id" = NULL
WHERE u."oidc_sub" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "users" o
    WHERE o."oidc_sub" = u."oidc_sub"
      AND o."id" <> u."id"
      AND (
        COALESCE(o."last_login_at", 'epoch'::timestamp) > COALESCE(u."last_login_at", 'epoch'::timestamp)
        OR (COALESCE(o."last_login_at", 'epoch'::timestamp) = COALESCE(u."last_login_at", 'epoch'::timestamp) AND o."id" > u."id")
      )
  );

CREATE UNIQUE INDEX "users_oidc_connection_id_oidc_sub_key" ON "users"("oidc_connection_id", "oidc_sub");

ALTER TABLE "tenants" ADD COLUMN "oidc_self_service" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "oidc_config" ADD COLUMN "allowed_domains" JSONB NOT NULL DEFAULT '[]';

UPDATE "oidc_config" SET "tenant_id" = "id";

INSERT INTO "tenants" ("id", "slug", "name", "description", "enabled", "created_at", "updated_at")
SELECT 'default', 'default', 'Default', 'Default tenant for all existing data', true, now(), now()
WHERE EXISTS (SELECT 1 FROM "oidc_config" WHERE "tenant_id" = 'default')
  AND NOT EXISTS (SELECT 1 FROM "tenants" WHERE "id" = 'default');

DELETE FROM "oidc_config" WHERE "tenant_id" NOT IN (SELECT "id" FROM "tenants");

DROP INDEX IF EXISTS "oidc_config_tenant_id_idx";

CREATE UNIQUE INDEX "oidc_config_tenant_id_key" ON "oidc_config"("tenant_id");

ALTER TABLE "oidc_config" ADD CONSTRAINT "oidc_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
