-- Multi-vDC per tenant (one per cluster): move the invariant into the DB.
-- Preflight: fail with an actionable message BEFORE the CREATE INDEX if
-- historical duplicates exist (only possible via direct API POSTs — the UI
-- rule was stricter than the new one).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vdcs GROUP BY tenant_id, connection_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'vdcs: duplicate (tenant_id, connection_id) rows — resolve before migrating';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vdcs GROUP BY tenant_id, slug HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'vdcs: duplicate (tenant_id, slug) rows — resolve before migrating';
  END IF;
END $$;

CREATE UNIQUE INDEX "vdcs_tenant_id_connection_id_key"
  ON "vdcs" ("tenant_id", "connection_id");
CREATE UNIQUE INDEX "vdcs_tenant_id_slug_key"
  ON "vdcs" ("tenant_id", "slug");
