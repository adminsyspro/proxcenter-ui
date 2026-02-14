/**
 * Lightweight DB migration script using better-sqlite3.
 * Runs on container startup to add missing columns without data loss.
 * Does NOT remove or rename columns — only additive, safe changes.
 */

const DB_PATH = (process.env.DATABASE_URL || 'file:/app/data/proxcenter.db').replace('file:', '')

try {
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH)

  // Get existing columns for Connection table
  const cols = new Set(db.pragma('table_info(Connection)').map(c => c.name))

  const migrations = [
    // Geo fields (2026-02-14)
    { table: 'Connection', column: 'latitude',      type: 'REAL' },
    { table: 'Connection', column: 'longitude',     type: 'REAL' },
    { table: 'Connection', column: 'locationLabel', type: 'TEXT' },
  ]

  let applied = 0

  for (const m of migrations) {
    if (!cols.has(m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`)
      console.log(`  + Added column ${m.table}.${m.column} (${m.type})`)
      applied++
    }
  }

  db.close()

  if (applied > 0) {
    console.log(`  ${applied} migration(s) applied.`)
  } else {
    console.log('  Schema is up to date.')
  }
} catch (err) {
  console.error('  Migration error:', err.message)
  process.exit(0) // Don't block container startup
}
