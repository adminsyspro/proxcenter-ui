INSERT INTO "rbac_permissions" ("id", "name", "category", "description", "is_dangerous") VALUES
('reports.manage', 'reports.manage', 'operations', 'Generate and delete reports, manage report schedules and their recipients', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT r."id", 'reports.manage'
FROM "rbac_roles" r
WHERE r."id" IN ('role_super_admin', 'role_provider_admin', 'role_operator', 'role_vm_admin', 'role_tenant_admin')
ON CONFLICT DO NOTHING;

INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", 'reports.manage'
FROM "rbac_role_permissions" rp
JOIN "rbac_roles" r ON r."id" = rp."role_id"
WHERE rp."permission_id" = 'reports.view'
  AND r."is_system" = false
  AND EXISTS (
    SELECT 1 FROM "rbac_role_permissions" am
    WHERE am."role_id" = rp."role_id" AND am."permission_id" = 'alerts.manage'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "rbac_user_permissions" ("id", "user_id", "permission_id", "scope_type", "scope_target", "tenant_id", "granted_by", "granted_at", "expires_at")
SELECT gen_random_uuid()::text, up."user_id", 'reports.manage', up."scope_type", up."scope_target", up."tenant_id", up."granted_by", up."granted_at",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "rbac_user_permissions" am
      WHERE am."user_id" = up."user_id" AND am."permission_id" = 'alerts.manage'
        AND am."scope_type" = up."scope_type" AND am."scope_target" IS NOT DISTINCT FROM up."scope_target"
        AND am."tenant_id" = up."tenant_id" AND am."expires_at" IS NULL
    ) THEN up."expires_at"
    ELSE LEAST(up."expires_at", (
      SELECT MAX(am."expires_at") FROM "rbac_user_permissions" am
      WHERE am."user_id" = up."user_id" AND am."permission_id" = 'alerts.manage'
        AND am."scope_type" = up."scope_type" AND am."scope_target" IS NOT DISTINCT FROM up."scope_target"
        AND am."tenant_id" = up."tenant_id"
    ))
  END
FROM "rbac_user_permissions" up
WHERE up."permission_id" = 'reports.view'
  AND EXISTS (
    SELECT 1 FROM "rbac_user_permissions" am
    WHERE am."user_id" = up."user_id" AND am."permission_id" = 'alerts.manage'
      AND am."scope_type" = up."scope_type" AND am."scope_target" IS NOT DISTINCT FROM up."scope_target"
      AND am."tenant_id" = up."tenant_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "rbac_user_permissions" x
    WHERE x."user_id" = up."user_id" AND x."permission_id" = 'reports.manage'
      AND x."scope_type" = up."scope_type" AND x."scope_target" IS NOT DISTINCT FROM up."scope_target"
      AND x."tenant_id" = up."tenant_id"
  );
