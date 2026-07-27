import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) {
    return "postgres://placeholder@localhost:5432/placeholder?sslmode=disable"
  }
  return url
}

function extractSchema(connectionString: string): string {
  try {
    const u = new URL(connectionString)
    const fromQuery = u.searchParams.get("schema")
    if (fromQuery && fromQuery.length > 0) return fromQuery
  } catch {
    // fall through
  }
  return "public"
}

const dsn = getDatabaseUrl()
const schema = extractSchema(dsn)

function createClient() {
  const pool = new pg.Pool({
    connectionString: dsn,
    max: Number(process.env.PG_POOL_MAX) || 10,
    connectionTimeoutMillis: 10_000,
  })
  return new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
    log: ["error", "warn"],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
