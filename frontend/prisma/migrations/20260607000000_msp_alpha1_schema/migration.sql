-- v1.5 MSP mode + multi-license + connection access profiles (alpha-1).
-- Strict order: add columns nullable -> preflight classifier (aborts on
-- AMBIGUOUS / dirty data) -> CHECK constraints -> pool table + bootstrap ->
-- FK swap on vdcs -> license/identity tables -> trigger functions + triggers.
-- This whole file runs in one transaction; any RAISE EXCEPTION rolls it all back.

-- ── (1) tenants.operating_model: add nullable first ────────────────────────
ALTER TABLE "tenants" ADD COLUMN "operating_model" TEXT;

-- ── (2) Preflight classifier: abort on dirty data, else classify ───────────
DO $$
DECLARE
  bad INTEGER;
BEGIN
  SELECT count(*) INTO bad
  FROM "vdcs" v LEFT JOIN "Connection" c ON c.id = v.connection_id
  WHERE c.id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight A.1: % orphan vdc(s) reference a missing connection; clean up before upgrading', bad; END IF;

  SELECT count(*) INTO bad
  FROM "Connection" c LEFT JOIN "tenants" t ON t.id = c.tenant_id
  WHERE c.tenant_id <> 'default' AND t.id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight A.2: % connection(s) reference a missing tenant', bad; END IF;

  SELECT count(*) INTO bad
  FROM "vdcs" v LEFT JOIN "tenants" t ON t.id = v.tenant_id
  WHERE v.tenant_id <> 'default' AND t.id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight A.3: % vdc(s) reference a missing tenant', bad; END IF;

  SELECT count(*) INTO bad
  FROM "Connection" c
  WHERE c.tenant_id <> 'default' AND c.type <> 'pve';
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight A.4: % non-PVE connection(s) are directly tenant-owned; reassign to default or remove before upgrading', bad; END IF;

  SELECT count(*) INTO bad
  FROM "vdcs" v JOIN "Connection" c ON c.id = v.connection_id
  WHERE c.tenant_id <> 'default' OR c.type <> 'pve';
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight A.5: % vdc(s) reference a non-pool connection (non-default-tenant or non-PVE)', bad; END IF;

  SELECT count(*) INTO bad
  FROM "tenants" t
  WHERE t.id <> 'default'
    AND EXISTS (SELECT 1 FROM "vdcs" WHERE tenant_id = t.id)
    AND EXISTS (SELECT 1 FROM "Connection" WHERE tenant_id = t.id AND type = 'pve');
  IF bad > 0 THEN RAISE EXCEPTION 'msp_alpha1 preflight B: % AMBIGUOUS tenant(s) own both vDCs and direct PVE connections; resolve manually before upgrading', bad; END IF;

  UPDATE "tenants" t SET operating_model = 'msp'
  WHERE t.id <> 'default'
    AND NOT EXISTS (SELECT 1 FROM "vdcs" WHERE tenant_id = t.id)
    AND EXISTS (SELECT 1 FROM "Connection" WHERE tenant_id = t.id AND type = 'pve');

  UPDATE "tenants" t SET operating_model = 'iaas'
  WHERE t.id <> 'default' AND operating_model IS NULL;
END $$;

-- ── (3) CHECK constraints on tenants (safe now: all rows compliant) ────────
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenant_operating_model_valid"
  CHECK (operating_model IS NULL OR operating_model IN ('iaas', 'msp'));

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenant_default_has_no_model"
  CHECK (
    (id = 'default' AND operating_model IS NULL)
    OR (id <> 'default' AND operating_model IS NOT NULL)
  );

-- ── (4) Connection.access_profile (default = today's behavior) ─────────────
ALTER TABLE "Connection" ADD COLUMN "access_profile" TEXT NOT NULL DEFAULT 'full_admin';
ALTER TABLE "Connection"
  ADD CONSTRAINT "connection_access_profile_valid"
  CHECK (access_profile IN ('readonly', 'operator', 'full_admin'));

CREATE INDEX "connection_tenant_id_idx" ON "Connection" (tenant_id) WHERE tenant_id <> 'default';

-- ── (5) provider_connections + bootstrap + FK swap on vdcs ─────────────────
CREATE TABLE "provider_connections" (
  "connection_id" TEXT PRIMARY KEY REFERENCES "Connection"(id) ON DELETE CASCADE
);

INSERT INTO "provider_connections" ("connection_id")
  SELECT id FROM "Connection" WHERE tenant_id = 'default' AND type = 'pve';

ALTER TABLE "vdcs"
  ADD CONSTRAINT "vdcs_connection_id_fkey"
  FOREIGN KEY (connection_id) REFERENCES "provider_connections"(connection_id) ON DELETE RESTRICT;

-- ── (6) install_identities ─────────────────────────────────────────────────
CREATE TABLE "install_identities" (
  "id"            TEXT PRIMARY KEY,
  "public_key"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_reset_at" TIMESTAMP(3)
);

-- ── (7) licenses + license_mappings ────────────────────────────────────────
CREATE TABLE "licenses" (
  "id"                  TEXT PRIMARY KEY,
  "license_id"          TEXT NOT NULL,
  "blob"                TEXT NOT NULL,
  "edition"             TEXT NOT NULL,
  "max_nodes"           INTEGER NOT NULL,
  "installable_count"   INTEGER,
  "cluster_uuid"        TEXT,
  "activated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "is_primary"          BOOLEAN NOT NULL DEFAULT false,
  "install_fingerprint" TEXT NOT NULL,
  "features"            JSONB,
  "state"               TEXT NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX "licenses_license_id_key" ON "licenses"("license_id");
CREATE INDEX "licenses_is_primary_idx" ON "licenses"("is_primary");
CREATE INDEX "licenses_state_idx" ON "licenses"("state");
CREATE UNIQUE INDEX "license_one_primary" ON "licenses"("is_primary") WHERE is_primary = true AND state = 'active';

CREATE TABLE "license_mappings" (
  "license_id"    TEXT NOT NULL REFERENCES "licenses"(id) ON DELETE CASCADE,
  "connection_id" TEXT NOT NULL REFERENCES "Connection"(id) ON DELETE CASCADE,
  PRIMARY KEY ("license_id", "connection_id")
);
CREATE UNIQUE INDEX "license_mappings_connection_id_key" ON "license_mappings"("connection_id");

-- ── (8) Trigger functions + triggers (anti-tamper safety nets) ─────────────
CREATE OR REPLACE FUNCTION enforce_connection_pool_sync_from_connection()
RETURNS TRIGGER AS $$
DECLARE pool_row_exists BOOLEAN;
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  IF NEW.type <> 'pve' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('connection:' || NEW.id));
  SELECT EXISTS (SELECT 1 FROM "provider_connections" WHERE connection_id = NEW.id) INTO pool_row_exists;
  IF NEW.tenant_id = 'default' AND NOT pool_row_exists THEN
    RAISE EXCEPTION 'PVE Connection % has tenant_id=default but no provider_connections row', NEW.id;
  END IF;
  IF NEW.tenant_id <> 'default' AND pool_row_exists THEN
    RAISE EXCEPTION 'PVE Connection % has tenant_id=% but is still in provider_connections', NEW.id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER connection_pool_sync_on_connection
  AFTER INSERT OR UPDATE OF tenant_id, type ON "Connection"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_connection_pool_sync_from_connection();

CREATE OR REPLACE FUNCTION enforce_connection_type_immutable()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  IF OLD.type IS DISTINCT FROM NEW.type THEN
    RAISE EXCEPTION 'Connection.type is immutable post-create (% -> %); create a new connection instead', OLD.type, NEW.type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connection_type_immutable
  BEFORE UPDATE OF type ON "Connection"
  FOR EACH ROW EXECUTE FUNCTION enforce_connection_type_immutable();

CREATE OR REPLACE FUNCTION enforce_connection_pool_sync_from_pool()
RETURNS TRIGGER AS $$
DECLARE conn_id TEXT; conn_tenant TEXT; conn_type TEXT; pool_row_exists BOOLEAN;
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  conn_id := COALESCE(NEW.connection_id, OLD.connection_id);
  PERFORM pg_advisory_xact_lock(hashtext('connection:' || conn_id));
  SELECT tenant_id, type INTO conn_tenant, conn_type FROM "Connection" WHERE id = conn_id;
  IF conn_tenant IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF conn_type <> 'pve' AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Cannot add non-PVE connection % (type=%) to provider_connections', conn_id, conn_type;
  END IF;
  SELECT EXISTS (SELECT 1 FROM "provider_connections" WHERE connection_id = conn_id) INTO pool_row_exists;
  IF conn_type = 'pve' AND conn_tenant = 'default' AND NOT pool_row_exists THEN
    RAISE EXCEPTION 'PVE Connection % has tenant_id=default but provider_connections row was removed', conn_id;
  END IF;
  IF conn_tenant <> 'default' AND pool_row_exists THEN
    RAISE EXCEPTION 'Connection % has tenant_id=% but a provider_connections row exists', conn_id, conn_tenant;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER connection_pool_sync_on_pool
  AFTER INSERT OR DELETE ON "provider_connections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_connection_pool_sync_from_pool();

CREATE OR REPLACE FUNCTION enforce_tenant_operating_model()
RETURNS TRIGGER AS $$
DECLARE mode TEXT; tid TEXT;
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  tid := NEW.tenant_id;
  IF tid = 'default' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('tenant:' || tid));
  SELECT operating_model INTO mode FROM "tenants" WHERE id = tid;
  IF mode IS NULL THEN RAISE EXCEPTION 'Tenant % not found or has no operating_model set', tid; END IF;
  IF TG_TABLE_NAME = 'vdcs' AND mode <> 'iaas' THEN
    RAISE EXCEPTION 'Tenant % operating_model=% cannot own vDCs (expected iaas)', tid, mode;
  END IF;
  IF TG_TABLE_NAME = 'Connection' AND mode <> 'msp' THEN
    RAISE EXCEPTION 'Tenant % operating_model=% cannot own connections directly (expected msp)', tid, mode;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vdc_tenant_model_check
  BEFORE INSERT OR UPDATE OF tenant_id ON "vdcs"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_operating_model();

CREATE TRIGGER connection_tenant_model_check
  BEFORE INSERT OR UPDATE OF tenant_id ON "Connection"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_operating_model();

CREATE OR REPLACE FUNCTION enforce_tenant_model_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  IF NEW.id = 'default' THEN RETURN NEW; END IF;
  IF OLD.operating_model IS NOT DISTINCT FROM NEW.operating_model THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('tenant:' || NEW.id));
  IF NEW.operating_model = 'msp' AND EXISTS (SELECT 1 FROM "vdcs" WHERE tenant_id = NEW.id) THEN
    RAISE EXCEPTION 'Tenant % still owns vDCs, cannot switch to msp mode', NEW.id;
  END IF;
  IF NEW.operating_model = 'iaas' AND EXISTS (SELECT 1 FROM "Connection" WHERE tenant_id = NEW.id) THEN
    RAISE EXCEPTION 'Tenant % still owns direct connections, cannot switch to iaas mode', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_model_change_check
  BEFORE UPDATE OF operating_model ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_model_change();

CREATE OR REPLACE FUNCTION enforce_tenant_delete_safe()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  IF OLD.id = 'default' THEN RAISE EXCEPTION 'Cannot delete the default (provider) tenant'; END IF;
  IF EXISTS (SELECT 1 FROM "Connection" WHERE tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'Tenant % still owns direct connections; reassign them to default first', OLD.id;
  END IF;
  IF EXISTS (SELECT 1 FROM "vdcs" WHERE tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'Tenant % still owns vDCs; delete them first', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_delete_safe
  BEFORE DELETE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_delete_safe();
