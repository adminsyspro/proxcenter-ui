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

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = getDatabasePath()
    ensureDirectory(dbPath)
    db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
