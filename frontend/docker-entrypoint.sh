#!/bin/sh
set -e

echo "[entrypoint] Running Prisma db push (auto-migrate schema)..."
prisma db push --schema ./prisma/schema.prisma --skip-generate 2>&1 || echo "[entrypoint] WARNING: prisma db push failed, continuing anyway"

echo "[entrypoint] Starting servers..."
exec concurrently --names "next,ws" --prefix "[{name}]" "node server.js" "node ws-proxy.js"
