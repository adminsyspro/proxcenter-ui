-- A vDC PBS namespace binding may only target a provider-pool PBS connection
-- (exists, type='pbs', tenant_id='default'). vdc_pbs_namespaces.pbs_connection_id
-- has no FK, so enforce the full invariant with triggers, serialized per-connection
-- with the same advisory-lock key namespace as the pool-sync triggers so a
-- concurrent assign + bind cannot race. Idempotent + upgrade preflight.
DROP TRIGGER IF EXISTS vdc_pbs_binding_pool_check ON "vdc_pbs_namespaces";
DROP TRIGGER IF EXISTS connection_pbs_binding_check ON "Connection";
DROP TRIGGER IF EXISTS connection_delete_pbs_bindings ON "Connection";

-- Preflight: refuse to install the invariant while invalid bindings already exist.
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM "vdc_pbs_namespaces" n
    WHERE NOT EXISTS (
      SELECT 1 FROM "Connection" c
      WHERE c.id = n.pbs_connection_id AND c.type = 'pbs' AND c.tenant_id = 'default'
    );
  IF bad > 0 THEN
    RAISE EXCEPTION 'Cannot apply: % vdc_pbs_namespaces row(s) target a missing/non-pbs/non-default connection; clean them up first', bad;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_vdc_pbs_binding_pool_owned()
RETURNS TRIGGER AS $$
DECLARE owner_tenant TEXT; conn_type TEXT;
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  PERFORM pg_advisory_xact_lock(hashtext('connection:' || NEW.pbs_connection_id));
  SELECT tenant_id, type INTO owner_tenant, conn_type FROM "Connection" WHERE id = NEW.pbs_connection_id;
  IF owner_tenant IS NULL THEN
    RAISE EXCEPTION 'vDC PBS binding target % does not exist', NEW.pbs_connection_id;
  END IF;
  IF conn_type <> 'pbs' THEN
    RAISE EXCEPTION 'vDC PBS binding target % is type % (expected pbs)', NEW.pbs_connection_id, conn_type;
  END IF;
  IF owner_tenant <> 'default' THEN
    RAISE EXCEPTION 'vDC PBS binding target % is owned by tenant % (not the provider pool)', NEW.pbs_connection_id, owner_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vdc_pbs_binding_pool_check
  BEFORE INSERT OR UPDATE OF pbs_connection_id ON "vdc_pbs_namespaces"
  FOR EACH ROW EXECUTE FUNCTION enforce_vdc_pbs_binding_pool_owned();

CREATE OR REPLACE FUNCTION enforce_pbs_owner_no_vdc_binding()
RETURNS TRIGGER AS $$
DECLARE binding_count INT;
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  PERFORM pg_advisory_xact_lock(hashtext('connection:' || NEW.id));
  IF NEW.type = 'pbs' AND NEW.tenant_id <> 'default' THEN
    SELECT count(*) INTO binding_count FROM "vdc_pbs_namespaces" WHERE pbs_connection_id = NEW.id;
    IF binding_count > 0 THEN
      RAISE EXCEPTION 'PBS connection % has % vDC namespace binding(s); cannot assign to tenant %', NEW.id, binding_count, NEW.tenant_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connection_pbs_binding_check
  BEFORE UPDATE OF tenant_id ON "Connection"
  FOR EACH ROW EXECUTE FUNCTION enforce_pbs_owner_no_vdc_binding();

-- Trigger 3: cascade-clean vDC PBS bindings before a Connection is deleted.
-- vdc_pbs_namespaces.pbs_connection_id has no FK, so without this trigger,
-- deleting a PBS connection leaves orphan binding rows. We delete them here
-- (vdc_pbs_pve_storages children cascade automatically via their FK onDelete).
CREATE OR REPLACE FUNCTION enforce_connection_delete_pbs_bindings()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config('search_path', TG_TABLE_SCHEMA || ', pg_catalog', true);
  PERFORM pg_advisory_xact_lock(hashtext('connection:' || OLD.id));
  -- vdc_pbs_pve_storages rows cascade from vdc_pbs_namespaces (FK onDelete=CASCADE),
  -- so deleting the namespace rows is sufficient; no manual child cleanup needed.
  DELETE FROM "vdc_pbs_namespaces" WHERE pbs_connection_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connection_delete_pbs_bindings
  BEFORE DELETE ON "Connection"
  FOR EACH ROW EXECUTE FUNCTION enforce_connection_delete_pbs_bindings();
