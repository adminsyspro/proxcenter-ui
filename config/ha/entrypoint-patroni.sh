#!/bin/sh
set -e

# Only substitute topology variables. Credentials are provided to Patroni
# via PATRONI_SUPERUSER_* / PATRONI_REPLICATION_* environment variables and
# must never be rendered into the YAML.
envsubst '${PATRONI_NAME} ${NODE_IP} ${PEER1_IP} ${PEER2_IP} ${PEER3_IP}' \
  < /etc/patroni/patroni.yml > /tmp/patroni.yml
chown postgres:postgres /tmp/patroni.yml

# Fix PGDATA ownership and permissions (standalone -> HA conversion)
if [ -d "$PGDATA" ]; then
  chown -R postgres:postgres "$PGDATA"
  chmod 0700 "$PGDATA"
fi

# Docker volume mount points cannot be removed or renamed. Clean stale
# partial data left by a failed pg_basebackup so the next attempt starts
# with an empty directory. A valid PGDATA (leader or restarted replica)
# always has PG_VERSION; its absence means an incomplete bootstrap.
if [ -d "$PGDATA" ] && [ ! -f "$PGDATA/PG_VERSION" ]; then
  rm -rf "$PGDATA"/* "$PGDATA"/.[!.]*
fi

# When converting from standalone, the replicator role may not exist.
# Wait for Postgres to accept connections, then ensure the role is present.
# The password travels as a psql variable (:'pw'), never interpolated into
# the SQL text, so any printable password works end to end.
ensure_replicator() {
  sleep 15
  for i in $(seq 1 30); do
    if pg_isready -h "$NODE_IP" -p 5432 -q 2>/dev/null; then
      ROLE=$(su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'leader' END;" 2>/dev/null || echo "")
      if [ "$ROLE" = "leader" ]; then
        EXISTS=$(su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -tAc "SELECT 1 FROM pg_roles WHERE rolname='replicator';" 2>/dev/null || echo "")
        if [ -z "$EXISTS" ]; then
          su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -v ON_ERROR_STOP=1 -v pw="$PATRONI_REPLICATION_PASSWORD" 2>/dev/null <<'EOSQL' && echo "entrypoint: replicator role created" || true
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD :'pw';
EOSQL
        fi
      fi
      return
    fi
    sleep 2
  done
}
ensure_replicator &

exec su-exec postgres patroni /tmp/patroni.yml
