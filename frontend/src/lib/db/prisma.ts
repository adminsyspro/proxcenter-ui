import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL

  if (!url) {
    // Build-time placeholder. The runtime instance gets the real URL from env.
    // An empty / unset URL would have crashed PrismaPg with a confusing
    // libpq parse error, so surface a clearer build-time fallback.
    return "postgres://placeholder@localhost:5432/placeholder?sslmode=disable"
  }


return url
}

/**
 * PrismaPg ignores the libpq-style `?schema=` query param on the connection
 * string (it's a Prisma migration / CLI extension, not a pg-protocol field).
 * The adapter only honours its own `schema` option, so without this every
 * query lands on `public` regardless of what the DSN says. The test setup
 * relies on per-run schemas in DATABASE_URL, so we mirror the parse here.
 */
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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: dsn }, { schema: extractSchema(dsn) }),
    log: ["error", "warn"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
