INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", 'storage.content'
FROM "rbac_role_permissions" rp
JOIN "rbac_roles" r ON r."id" = rp."role_id"
WHERE rp."permission_id" = 'vm.view'
  AND r."is_system" = false
  AND EXISTS (SELECT 1 FROM "rbac_permissions" p WHERE p."id" = 'storage.content')
ON CONFLICT DO NOTHING;
