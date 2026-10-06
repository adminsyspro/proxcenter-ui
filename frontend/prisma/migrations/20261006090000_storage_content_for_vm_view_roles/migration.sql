INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", 'storage.content'
FROM "rbac_role_permissions" rp
JOIN "rbac_roles" r ON r."id" = rp."role_id"
WHERE rp."permission_id" = 'vm.view'
  AND r."is_system" = false
  AND EXISTS (SELECT 1 FROM "rbac_permissions" p WHERE p."id" = 'storage.content')
ON CONFLICT DO NOTHING;

INSERT INTO "rbac_user_permissions" ("id", "user_id", "permission_id", "scope_type", "scope_target", "tenant_id", "granted_by", "granted_at", "expires_at")
SELECT gen_random_uuid()::text, up."user_id", 'storage.content', up."scope_type", up."scope_target", up."tenant_id", up."granted_by", up."granted_at", up."expires_at"
FROM "rbac_user_permissions" up
WHERE up."permission_id" = 'vm.view'
  AND EXISTS (SELECT 1 FROM "rbac_permissions" p WHERE p."id" = 'storage.content')
  AND NOT EXISTS (
    SELECT 1 FROM "rbac_user_permissions" x
    WHERE x."user_id" = up."user_id" AND x."permission_id" = 'storage.content'
      AND x."scope_type" = up."scope_type" AND x."scope_target" IS NOT DISTINCT FROM up."scope_target"
      AND x."tenant_id" = up."tenant_id"
  );
