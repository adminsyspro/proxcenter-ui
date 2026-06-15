-- Widen the DashboardLayout unique constraint to include tenant_id so that
-- the same (userId, name) pair can exist independently in each tenant.
-- The old index only covered (userId, name), which caused the session-scoped
-- Prisma upsert to collide with the provider's existing "Default" row when a
-- super-admin also had a dashboard row in the provider scope.

DROP INDEX IF EXISTS "DashboardLayout_userId_name_key";

CREATE UNIQUE INDEX "DashboardLayout_tenantId_userId_name_key"
  ON "DashboardLayout" (tenant_id, "userId", name);
