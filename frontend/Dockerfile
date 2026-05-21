# syntax=docker/dockerfile:1

# ========================================
# Stage 1: Dependencies
# ========================================
FROM node:26-alpine AS deps

WORKDIR /app

# Copy package files (including lock file for reproducible builds)
COPY package.json package-lock.json ./

# Install dependencies WITHOUT running postinstall (source files not yet
# available). No native modules left to compile since better-sqlite3 was
# dropped (post-step-2.7 cleanup), so we skip python/make/g++ entirely.
RUN npm ci --legacy-peer-deps --ignore-scripts

# ========================================
# Stage 2: Builder
# ========================================
FROM node:26-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Generate icon CSS bundle
RUN npm run build:icons

# Generate Prisma client
RUN npx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Git commit SHA for version display (injected by CI)
ARG GIT_SHA=""
ENV NEXT_PUBLIC_GIT_SHA=${GIT_SHA}

# App version for display (injected by CI on tagged releases)
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

# Demo mode (set to "true" for demo builds — inlined at build time)
ARG DEMO_MODE=""
ENV DEMO_MODE=${DEMO_MODE}
ENV NEXT_PUBLIC_DEMO_MODE=${DEMO_MODE}

# Create data directory (used at runtime for branding logo uploads, etc.)
RUN mkdir -p /app/data

RUN npm run build

# Bundle the Prisma seed script to a self-contained CommonJS file so the
# runner stage can execute it via plain `node` (no tsx / esbuild at runtime).
# @prisma/client and @prisma/adapter-pg stay external — they are copied into
# the runner stage from node_modules below.
RUN npx esbuild prisma/seed.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=cjs \
    --outfile=prisma/seed.js \
    --external:@prisma/client \
    --external:@prisma/adapter-pg

# Strip dev dependencies from node_modules so the runner stage can adopt the
# whole tree as-is. Production deps include the prisma CLI + its transitive
# graph (pathe, hono, @electric-sql/pglite, …), which would otherwise need
# dozens of selective COPY lines to assemble correctly.
#
# The `rm -rf` strips packages that .next/standalone bundles its own (lean,
# trace-driven) copy of, so the final image doesn't carry both. @swc is a
# build-time compiler and is never imported at runtime — also dropped.
# Doing this here, in the same RUN layer, means the runner-stage COPY of
# /app/node_modules pulls the slim tree directly (~480 MB saved versus
# pruning in the runner where Docker layers preserve the heavier original).
RUN npm prune --omit=dev --legacy-peer-deps --ignore-scripts && \
    rm -rf node_modules/next node_modules/@next node_modules/@swc

# ========================================
# Stage 3: Runner
# ========================================
FROM node:26-alpine AS runner

ARG GIT_SHA=""

WORKDIR /app

# Patch npm to a version whose bundled dependencies clear the latest
# CVE round (ip-address < 10.1.1 / CVE-2026-42338, brace-expansion <
# 5.0.6 / CVE-2026-45149, etc.). Pinning the version keeps the build
# reproducible; bump this line when a newer bundle becomes available.
# The npm cache is wiped afterwards so the layer does not grow.
RUN npm install -g npm@11.15.0 && npm cache clean --force

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_SHA=${GIT_SHA}

# Demo mode (runtime — middleware checks this)
ARG DEMO_MODE=""
ENV DEMO_MODE=${DEMO_MODE}

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create data directory (used by the app for branding logo uploads, etc.)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy public assets
COPY --from=builder /app/public ./public

# Pruned production node_modules from the builder (already trimmed of
# next/@next/@swc — see the prune step above). Carries the Prisma CLI +
# its full transitive graph, @prisma/client, adapter-pg, pg.
# --chmod=0555 makes the application code read+execute only, preventing
# in-container tampering by a compromised process (defense in depth on
# top of running as the non-root `nextjs` user).
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/node_modules ./node_modules

# Standalone Next.js bundle: server.js, lean traced node_modules
# (re-adds next + @next entries the prune dropped) and the compiled
# .next/ tree.
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/.next/static ./.next/static

# Prisma schema, migrations and pre-bundled seed.js (built by esbuild above).
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/prisma.config.ts ./prisma.config.ts

# Unified server entry point + WebSocket proxy.
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/start.js ./start.js
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/ws-proxy.js ./ws-proxy.js

# Package metadata (used by the startup banner for the version label).
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/package.json ./package.json

# No extra runtime dependencies — start.js runs as single process

# Switch to non-root user
USER nextjs

# Expose port (unified HTTP + WebSocket)
EXPOSE 3000

# Environment variables (can be overridden)
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# DATABASE_URL has no default on purpose — the entrypoint refuses to boot
# without it. The bundled docker-compose stack injects the right Postgres
# connection string.

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Copy entrypoint
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Start: entrypoint inits DB, CMD starts unified server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "start.js"]
