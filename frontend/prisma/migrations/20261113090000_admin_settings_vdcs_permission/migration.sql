INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('admin.settings.vdcs', 'admin.settings.vdcs', 'admin', 'Manage vDCs, their GPU quota, storage policies and shared EVPN zones (implied by admin.settings)', true)
ON CONFLICT ("id") DO NOTHING;
