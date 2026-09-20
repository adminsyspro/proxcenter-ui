INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('vm.config.nic.mac', 'vm.config.nic.mac', 'vm', 'Explicitly allow tenant NIC MAC address changes', true),
('vm.config.nic.vlan', 'vm.config.nic.vlan', 'vm', 'Explicitly allow tenant NIC VLAN tag and trunk changes', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.id IN ('role_super_admin', 'role_provider_admin') AND p.id IN ('vm.config.nic.mac', 'vm.config.nic.vlan')
ON CONFLICT DO NOTHING;

UPDATE "rbac_permissions" SET "description" = 'Modify VM configuration (excludes explicit tenant MAC and VLAN rights)' WHERE "id" = 'vm.config';
UPDATE "rbac_permissions" SET "description" = 'Add, remove and edit NICs (excludes explicit tenant MAC and VLAN rights)' WHERE "id" = 'vm.config.nic';
