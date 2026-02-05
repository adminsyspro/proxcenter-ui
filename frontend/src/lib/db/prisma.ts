import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import Database from "better-sqlite3"
import path from "path"
import fs from "fs"

// Parse database URL - handle both "file:" prefix and plain paths
function getDatabasePath(): string {
  const url = process.env.DATABASE_URL || "file:./data/proxcenter.db"

  // Remove file: prefix if present
  let dbPath = url.startsWith("file:") ? url.slice(5) : url

  // Handle relative paths
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath)
  }

  return dbPath
}

// Ensure the directory exists
function ensureDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Global store for singleton
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  sqlite: Database.Database | undefined
}

// Lazy initialization function
function createPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }

  try {
    const dbPath = getDatabasePath()
    ensureDirectory(dbPath)

    // Create SQLite database connection
    const sqlite = new Database(dbPath)
    sqlite.pragma("journal_mode = WAL")

    // Store for potential cleanup
    globalForPrisma.sqlite = sqlite

    // Create Prisma adapter
    const adapter = new PrismaBetterSqlite3(sqlite)

    // Create Prisma client with adapter
    const client = new PrismaClient({
      adapter,
    })

    // Always cache the client to avoid reconnection issues
    globalForPrisma.prisma = client

    return client
  } catch (error) {
    console.error("Failed to initialize Prisma client:", error)
    throw error
  }
}

// Export a getter that lazily creates the client
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const client = createPrismaClient()
    return (client as any)[prop]
  }
})

// Also export the function for explicit initialization
export function getPrisma(): PrismaClient {
  return createPrismaClient()
}
