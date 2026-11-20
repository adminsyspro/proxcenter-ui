ALTER TABLE "users" ADD COLUMN "service_account" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "description" TEXT;

ALTER TABLE "api_tokens" ADD COLUMN "service_account_id" TEXT;
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "api_tokens_service_account_id_idx" ON "api_tokens"("service_account_id");

INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('admin.apitokens.view', 'admin.apitokens.view', 'admin', 'View API tokens and service accounts, never their secrets (implied by admin.apitokens)', false),
('admin.settings.identity', 'admin.settings.identity', 'admin', 'Manage the identity provider connection of customer tenants (implied by admin.settings)', true)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "tenants" ADD COLUMN "api_self_service" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.id = 'role_tenant_admin' AND p.id = 'admin.apitokens'
ON CONFLICT DO NOTHING;
