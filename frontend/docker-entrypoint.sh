#!/bin/sh
set -e

echo "[entrypoint] Running DB migrations..."
node db-migrate.js

echo "[entrypoint] Starting servers..."
exec concurrently --names "next,ws" --prefix "[{name}]" "node server.js" "node ws-proxy.js"
