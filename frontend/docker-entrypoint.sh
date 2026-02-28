#!/bin/sh
set -e

# ── Docker Secrets support ──────────────────────────────────────────
# For each VAR in the list, if VAR_FILE is set, read the file contents
# into VAR. This allows using Docker Swarm secrets or any file-based
# secret injection (e.g. /run/secrets/<name>).
for secret_var in APP_SECRET NEXTAUTH_SECRET DATABASE_URL ORCHESTRATOR_API_KEY LICENSE_KEY; do
  file_var="${secret_var}_FILE"
  eval file_path="\$$file_var"
  if [ -n "$file_path" ]; then
    if [ -f "$file_path" ]; then
      val=$(cat "$file_path" | tr -d '\n')
      export "$secret_var"="$val"
      echo "[entrypoint] Loaded $secret_var from $file_path"
    else
      echo "[entrypoint] WARNING: $file_var=$file_path but file does not exist"
    fi
  fi
done

DB_PATH="${DATABASE_URL:-file:/app/data/proxcenter.db}"
DB_FILE=$(echo "$DB_PATH" | sed 's|^file:||')
DB_DIR=$(dirname "$DB_FILE")

# Ensure data directory exists and is writable
if [ ! -d "$DB_DIR" ]; then
  echo "[entrypoint] Creating data directory: $DB_DIR"
  mkdir -p "$DB_DIR"
fi

if [ ! -w "$DB_DIR" ]; then
  echo "[entrypoint] ERROR: Data directory $DB_DIR is not writable by user $(id -u)"
  echo "[entrypoint] Fix: run 'chown -R 1001:1001 $DB_DIR' on the host"
  exit 1
fi

# Initialize schema + run additive migrations (uses better-sqlite3 directly)
echo "[entrypoint] Initializing database..."
node db-migrate.js

echo "[entrypoint] Starting..."
exec "$@"
