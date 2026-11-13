#!/bin/sh
set -e

# Only substitute topology variables and role names (the hardened pg_hba
# names the superuser and replication roles). Credentials are provided to
# Patroni via PATRONI_* environment variables and must never be rendered
# into the YAML.
envsubst '${PATRONI_NAME} ${NODE_IP} ${PEER1_IP} ${PEER2_IP} ${PEER3_IP} ${VIP} ${PATRONI_SUPERUSER_USERNAME} ${PATRONI_REPLICATION_USERNAME}' \
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

# When converting from standalone, the replication role may not exist.
# Wait for Postgres to accept connections, then ensure the role named by
# PATRONI_REPLICATION_USERNAME is present. Every psql call goes through the
# local unix socket ("local all all trust"), never over TCP: the hardened
# pg_hba only admits TLS sessions with a password from the cluster nodes.
# The role name and the password are read by psql itself from the
# environment (\getenv) and used as psql variables (:"role", :'pw'): they are
# never on a command line (visible in /proc) nor interpolated into the SQL
# text, so any printable value works.
ensure_replicator() {
  export PATRONI_REPLICATION_USERNAME="${PATRONI_REPLICATION_USERNAME:-replicator}"
  sleep 15
  for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then
      ROLE=$(su-exec postgres psql -U "$PGUSER" -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'leader' END;" 2>/dev/null || echo "")
      if [ "$ROLE" = "leader" ]; then
        EXISTS=$(printf '%s\n' '\getenv role PATRONI_REPLICATION_USERNAME' "SELECT 1 FROM pg_roles WHERE rolname = :'role';" | su-exec postgres psql -U "$PGUSER" -tA 2>/dev/null || echo "")
        if [ -z "$EXISTS" ]; then
          su-exec postgres psql -U "$PGUSER" -v ON_ERROR_STOP=1 2>/dev/null <<'EOSQL' && echo "entrypoint: replication role created" || true
\getenv role PATRONI_REPLICATION_USERNAME
\getenv pw PATRONI_REPLICATION_PASSWORD
CREATE ROLE :"role" WITH REPLICATION LOGIN PASSWORD :'pw';
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
