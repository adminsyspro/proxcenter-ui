#!/bin/sh
set -e

envsubst < /etc/patroni/patroni.yml > /tmp/patroni.yml
chown postgres:postgres /tmp/patroni.yml

# Fix PGDATA ownership and permissions (standalone -> HA conversion)
if [ -d "$PGDATA" ]; then
  chown -R postgres:postgres "$PGDATA"
  chmod 0700 "$PGDATA"
fi

# When converting from standalone, the replicator role may not exist.
# Wait for Postgres to accept connections, then ensure the role is present.
ensure_replicator() {
  sleep 15
  for i in $(seq 1 30); do
    if pg_isready -h "$NODE_IP" -p 5432 -q 2>/dev/null; then
      ROLE=$(su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'leader' END;" 2>/dev/null || echo "")
      if [ "$ROLE" = "leader" ]; then
        EXISTS=$(su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -tAc "SELECT 1 FROM pg_roles WHERE rolname='replicator';" 2>/dev/null || echo "")
        if [ -z "$EXISTS" ]; then
          su-exec postgres psql -h "$NODE_IP" -U "$PGUSER" -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$PGPASSWORD';" 2>/dev/null && \
            echo "entrypoint: replicator role created" || true
        fi
      fi
      return
    fi
    sleep 2
  done
}
ensure_replicator &

exec su-exec postgres patroni /tmp/patroni.yml
