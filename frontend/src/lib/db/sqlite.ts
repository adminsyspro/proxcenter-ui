import Database from "better-sqlite3"

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/proxcenter.db"

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
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
