#!/bin/sh
set -e

echo "[entrypoint] Running DB migrations..."
node db-migrate.js

echo "[entrypoint] Starting servers..."
exec concurrently --names "next,gateway" --prefix "[{name}]" \
  "PORT=3100 HOSTNAME=127.0.0.1 node server.js" \
  "node ws-proxy.js"
