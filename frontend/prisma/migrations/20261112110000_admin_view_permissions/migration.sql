INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('admin.users.view', 'admin.users.view', 'admin', 'View users and their tenant memberships (implied by admin.users)', false),
('admin.rbac.view', 'admin.rbac.view', 'admin', 'View roles, permissions and role assignments (implied by admin.rbac)', false),
('admin.settings.view', 'admin.settings.view', 'admin', 'View provider settings: vDCs, EVPN zones, storage policies (implied by admin.settings)', false),
('admin.tenants.view', 'admin.tenants.view', 'admin', 'View tenants and their members (implied by admin.tenants)', false)
ON CONFLICT ("id") DO NOTHING;
