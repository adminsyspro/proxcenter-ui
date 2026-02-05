import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function getDatabaseUrl() {
  // Default to local path for build time, overridden at runtime by env var
  return process.env.DATABASE_URL || "file:./data/proxcenter.db"
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: getDatabaseUrl() }),
    log: ["error", "warn"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
