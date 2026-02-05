# syntax=docker/dockerfile:1

# ========================================
# Stage 1: Dependencies
# ========================================
FROM node:22-alpine AS deps

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy package files
COPY package.json ./

# Install dependencies WITHOUT running postinstall (source files not yet available)
RUN npm install --legacy-peer-deps --ignore-scripts

# ========================================
# Stage 2: Builder
# ========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Rebuild better-sqlite3 native module for this platform
RUN npm rebuild better-sqlite3

# Now run postinstall scripts (build:icons) - source files are available
RUN npm run build:icons

# Generate Prisma client
RUN npx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Create data directory for SQLite (needed during build for page data collection)
RUN mkdir -p /app/data

RUN npm run build

# ========================================
# Stage 3: Runner
# ========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install runtime dependencies
RUN apk add --no-cache sqlite-dev

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create data directory for SQLite
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy better-sqlite3 native module (required for Prisma with SQLite)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Copy Prisma adapter and client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma ./prisma

# Copy Prisma CLI binary and make it available globally (for migrations)
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
RUN ln -s /app/node_modules/.bin/prisma /usr/local/bin/prisma

# Copy WebSocket proxy and its dependencies
COPY --from=builder /app/ws-proxy.js ./ws-proxy.js
COPY --from=builder /app/node_modules/ws ./node_modules/ws

# Install concurrently for running both servers
RUN npm install -g concurrently

# Switch to non-root user
USER nextjs

# Expose ports
EXPOSE 3000
EXPOSE 3001

# Environment variables (can be overridden)
ENV PORT=3000
ENV WS_PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/proxcenter.db"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start both Next.js server and WebSocket proxy
CMD ["concurrently", "--names", "next,ws", "--prefix", "[{name}]", "node server.js", "node ws-proxy.js"]
