INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('admin.identity', 'admin.identity', 'admin', 'Manage the tenant''s own identity provider, when the provider allows it', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.id IN ('role_super_admin', 'role_provider_admin', 'role_tenant_admin') AND p.id = 'admin.identity'
ON CONFLICT DO NOTHING;
