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

# Initialize Prisma schema (creates tables if missing, idempotent)
echo "[entrypoint] Initializing database schema..."
if node ./node_modules/prisma/build/index.js db push --schema /app/prisma/schema.migrate.prisma --accept-data-loss --skip-generate 2>&1; then
  echo "[entrypoint] Schema OK"
else
  echo "[entrypoint] WARN: prisma db push failed, trying direct init..."
  # Fallback: create the DB file so better-sqlite3 can work
  if [ ! -f "$DB_FILE" ]; then
    touch "$DB_FILE"
  fi
fi

# Run additive migrations (add columns, etc.)
echo "[entrypoint] Running DB migrations..."
node db-migrate.js

echo "[entrypoint] Starting servers..."
exec concurrently --names "next,ws" --prefix "[{name}]" "node server.js" "node ws-proxy.js"
