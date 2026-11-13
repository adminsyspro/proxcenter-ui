ALTER TABLE "rbac_roles" ADD COLUMN "audience" TEXT,
ADD COLUMN "publish_all" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_audience_check"
  CHECK ("audience" IS NULL OR ("audience" IN ('provider', 'service_desk', 'tenant') AND "is_system" = false AND "tenant_id" = 'default'));

CREATE TABLE "rbac_role_publications" (
    "role_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "rbac_role_publications_pkey" PRIMARY KEY ("role_id","tenant_id")
);

CREATE TABLE "rbac_service_desk_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "all_tenants" BOOLEAN NOT NULL DEFAULT true,
    "tenant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "granted_by" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "rbac_service_desk_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rbac_role_publications_tenant_id_idx" ON "rbac_role_publications"("tenant_id");
CREATE INDEX "rbac_service_desk_assignments_role_id_idx" ON "rbac_service_desk_assignments"("role_id");
CREATE UNIQUE INDEX "rbac_service_desk_assignments_user_id_role_id_key" ON "rbac_service_desk_assignments"("user_id", "role_id");

ALTER TABLE "rbac_role_publications" ADD CONSTRAINT "rbac_role_publications_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rbac_role_publications" ADD CONSTRAINT "rbac_role_publications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rbac_service_desk_assignments" ADD CONSTRAINT "rbac_service_desk_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rbac_service_desk_assignments" ADD CONSTRAINT "rbac_service_desk_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rbac_service_desk_assignments" ADD CONSTRAINT "rbac_service_desk_assignments_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provider-owned custom roles that already reach customer tenants through the
-- OIDC group mapping keep doing so: grandfathered as publications of a legacy
-- (audience NULL) role, honoured by the SSO sync only.
INSERT INTO "rbac_role_publications" ("role_id", "tenant_id")
SELECT DISTINCT ur."role_id", ur."tenant_id"
FROM "rbac_user_roles" ur
JOIN "rbac_roles" r ON r."id" = ur."role_id"
JOIN "tenants" t ON t."id" = ur."tenant_id"
WHERE r."is_system" = false AND r."tenant_id" = 'default' AND ur."tenant_id" <> 'default'
UNION
SELECT DISTINCT r."id", t."id"
FROM "oidc_config" c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c."group_role_mapping") = 'array' THEN c."group_role_mapping" ELSE '[]'::jsonb END
) e
JOIN "rbac_roles" r ON r."id" IN (e->>'role', 'role_' || (e->>'role'))
JOIN "tenants" t ON t."id" = COALESCE(e->>'tenantId', e->>'tenant')
WHERE r."is_system" = false AND r."tenant_id" = 'default' AND t."id" <> 'default'
ON CONFLICT DO NOTHING;
