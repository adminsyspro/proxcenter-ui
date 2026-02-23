/**
 * Lightweight DB init + migration script using better-sqlite3.
 * Runs on container startup:
 *   1. Creates Prisma-managed tables if they don't exist (replaces prisma db push)
 *   2. Adds missing columns without data loss (additive migrations only)
 */

const DB_PATH = (process.env.DATABASE_URL || 'file:/app/data/proxcenter.db').replace('file:', '')

try {
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH)

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL')

  // ============================================
  // Step 1: Create tables if they don't exist
  // (mirrors prisma/schema.migrate.prisma)
  // ============================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS "Connection" (
      "id"            TEXT NOT NULL PRIMARY KEY,
      "name"          TEXT NOT NULL,
      "type"          TEXT NOT NULL DEFAULT 'pve',
      "baseUrl"       TEXT NOT NULL,
      "uiUrl"         TEXT,
      "insecureTLS"   INTEGER NOT NULL DEFAULT 0,
      "hasCeph"       INTEGER NOT NULL DEFAULT 0,
      "apiTokenEnc"   TEXT NOT NULL,
      "sshEnabled"    INTEGER NOT NULL DEFAULT 0,
      "sshPort"       INTEGER NOT NULL DEFAULT 22,
      "sshUser"       TEXT NOT NULL DEFAULT 'root',
      "sshAuthMethod" TEXT,
      "sshKeyEnc"     TEXT,
      "sshPassEnc"    TEXT,
      "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "ManagedHost" (
      "id"           TEXT NOT NULL PRIMARY KEY,
      "connectionId" TEXT,
      "node"         TEXT NOT NULL,
      "displayName"  TEXT,
      "enabled"      INTEGER NOT NULL DEFAULT 1,
      "notes"        TEXT,
      "description"  TEXT,
      "tags"         TEXT,
      "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "ManagedHost_connectionId_node_key"
      ON "ManagedHost" ("connectionId", "node");

    CREATE TABLE IF NOT EXISTS "DashboardLayout" (
      "id"        TEXT NOT NULL PRIMARY KEY,
      "userId"    TEXT NOT NULL DEFAULT 'default',
      "name"      TEXT NOT NULL DEFAULT 'custom',
      "widgets"   TEXT NOT NULL,
      "isActive"  INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "DashboardLayout_userId_name_key"
      ON "DashboardLayout" ("userId", "name");

    CREATE TABLE IF NOT EXISTS "alerts" (
      "id"              TEXT NOT NULL PRIMARY KEY,
      "fingerprint"     TEXT NOT NULL,
      "severity"        TEXT NOT NULL,
      "message"         TEXT NOT NULL,
      "source"          TEXT NOT NULL,
      "source_type"     TEXT NOT NULL DEFAULT 'pve',
      "entity_type"     TEXT,
      "entity_id"       TEXT,
      "entity_name"     TEXT,
      "metric"          TEXT,
      "current_value"   REAL,
      "threshold"       REAL,
      "status"          TEXT NOT NULL DEFAULT 'active',
      "occurrences"     INTEGER NOT NULL DEFAULT 1,
      "first_seen_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_seen_at"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "acknowledged_at" DATETIME,
      "acknowledged_by" TEXT,
      "resolved_at"     DATETIME,
      "created_at"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "alerts_fingerprint_key" ON "alerts" ("fingerprint");
    CREATE INDEX IF NOT EXISTS "alerts_status_idx"       ON "alerts" ("status");
    CREATE INDEX IF NOT EXISTS "alerts_severity_idx"     ON "alerts" ("severity");
    CREATE INDEX IF NOT EXISTS "alerts_source_idx"       ON "alerts" ("source");
    CREATE INDEX IF NOT EXISTS "alerts_last_seen_at_idx" ON "alerts" ("last_seen_at");

    CREATE TABLE IF NOT EXISTS "blueprints" (
      "id"          TEXT NOT NULL PRIMARY KEY,
      "name"        TEXT NOT NULL,
      "description" TEXT,
      "image_slug"  TEXT NOT NULL,
      "hardware"    TEXT NOT NULL,
      "cloud_init"  TEXT,
      "tags"        TEXT,
      "is_public"   INTEGER NOT NULL DEFAULT 1,
      "created_by"  TEXT,
      "created_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "deployments" (
      "id"              TEXT NOT NULL PRIMARY KEY,
      "blueprint_id"    TEXT,
      "blueprint_name"  TEXT,
      "connection_id"   TEXT NOT NULL,
      "node"            TEXT NOT NULL,
      "vmid"            INTEGER NOT NULL,
      "vm_name"         TEXT,
      "image_slug"      TEXT,
      "status"          TEXT NOT NULL DEFAULT 'pending',
      "current_step"    TEXT,
      "error"           TEXT,
      "task_upid"       TEXT,
      "started_at"      DATETIME,
      "completed_at"    DATETIME,
      "created_at"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "deployments_status_idx"        ON "deployments" ("status");
    CREATE INDEX IF NOT EXISTS "deployments_connection_id_idx" ON "deployments" ("connection_id");
  `)

  console.log('  Tables OK')

  // ============================================
  // Step 2: Additive column migrations
  // ============================================

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
