#!/bin/sh
set -e

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

echo "[entrypoint] Starting servers..."
exec concurrently --names "next,ws" --prefix "[{name}]" "node server.js" "node ws-proxy.js"
