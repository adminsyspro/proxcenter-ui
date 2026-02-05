import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import Database from "better-sqlite3"

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/proxcenter.db"

const sqlite = new Database(dbPath)
const adapter = new PrismaBetterSqlite3(sqlite)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
