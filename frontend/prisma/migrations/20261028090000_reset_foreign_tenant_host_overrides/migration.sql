UPDATE "ManagedHost" AS h
SET tenant_id = c.tenant_id,
    "sshAddress" = NULL,
    "sshPort" = NULL
FROM "Connection" AS c
WHERE h."connectionId" = c.id
  AND h.tenant_id <> 'default'
  AND h.tenant_id <> c.tenant_id;
