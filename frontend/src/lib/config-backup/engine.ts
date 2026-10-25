// Dump and restore of the configuration tables listed in ./tables.
//
// Rows travel as Postgres JSON (row_to_json out, json_populate_recordset in),
// so the engine needs no per-table code and survives schema changes in both
// directions: a column the file lacks takes its default, a column this
// install lacks is ignored. The restore replaces the tables in one
// transaction, deleting children before parents and inserting parents before
// children, in the order the live foreign keys dictate.

import type { Prisma, PrismaClient } from '@prisma/client'

import { BACKUP_SECTIONS, BACKUP_TABLES, orderForInsert, type BackupSectionKey, type BackupTable } from './tables'
import { openSecrets, sealSecrets, type Decrypt, type Encrypt } from './secrets'

type Db = PrismaClient | Prisma.TransactionClient
type Row = Record<string, unknown>

export interface BackupPayload {
  /** Last Prisma migration applied on the install that wrote the file. */
  migration: string | null
  tables: Record<string, Row[]>
  /** Fingerprint of the APP_SECRET of the install that wrote the file (see installKeyCheck). */
  keyCheck?: string
  /** Install identity (install_identities) of the install that wrote the file. */
  sourceInstall?: string | null
}

export type SchemaCompatibility = 'same' | 'older' | 'newer' | 'unknown'

export interface BackupSummary {
  migration: string | null
  compatibility: SchemaCompatibility
  sections: { key: BackupSectionKey; rows: number }[]
  /** Tables of the file this install does not have; skipped on import. */
  unknownTables: string[]
}

export interface RestoreResult {
  tables: number
  rows: number
  secrets: number
  skippedTables: string[]
}

const INSERT_CHUNK = 500

const quote = (ident: string) => `"${ident.replaceAll('"', '""')}"`

// Raw queries do not go through the adapter's schema option, they run on the
// connection's search_path. Every engine call therefore runs in a transaction
// that pins search_path to the schema the application uses.
function inSchema<T>(
  db: PrismaClient,
  schema: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  return db.$transaction(
    async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('search_path', $1, true)`, quote(schema))
      return fn(tx)
    },
    { maxWait: 10_000, timeout: 30_000, ...options },
  )
}

async function existingTables(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  )
  return new Set(rows.map(r => r.name))
}

async function latestMigration(db: Db): Promise<string | null> {
  if (!(await existingTables(db)).has('_prisma_migrations')) return null
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT migration_name AS name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`,
  )
  return rows[0]?.name ?? null
}

export function dumpConfiguration(db: PrismaClient, schema: string, decrypt: Decrypt): Promise<{ payload: BackupPayload; secrets: number }> {
  // Repeatable read: every table is read from the same snapshot, so a write
  // landing mid-export cannot leave a child row without its parent.
  return inSchema(
    db,
    schema,
    async tx => {
      const present = await existingTables(tx)
      const tables: Record<string, Row[]> = {}

      for (const table of BACKUP_TABLES) {
        if (!present.has(table.name)) continue
        const where = table.exportWhere ? ` WHERE ${table.exportWhere}` : ''
        const rows = await tx.$queryRawUnsafe<{ row: Row }[]>(`SELECT row_to_json(t) AS row FROM ${quote(table.name)} t${where}`)
        tables[table.name] = rows.map(r => r.row)
      }

      const opened = openSecrets(tables, decrypt)
      return { payload: { migration: await latestMigration(tx), tables: opened.value }, secrets: opened.count }
    },
    { isolationLevel: 'RepeatableRead', timeout: 60_000 },
  )
}

export function compareMigrations(file: string | null, local: string | null): SchemaCompatibility {
  if (!file || !local) return 'unknown'
  if (file === local) return 'same'
  // Migration names start with a UTC timestamp, so they sort by date.
  return file < local ? 'older' : 'newer'
}

export function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const tables = (value as BackupPayload).tables
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return false
  return Object.values(tables).every(rows => Array.isArray(rows) && rows.every(r => r && typeof r === 'object' && !Array.isArray(r)))
}

export function summarizeBackup(db: PrismaClient, schema: string, payload: BackupPayload): Promise<BackupSummary> {
  return inSchema(db, schema, async tx => summarize(tx, payload))
}

async function summarize(tx: Db, payload: BackupPayload): Promise<BackupSummary> {
  const present = await existingTables(tx)
  const known = new Set(BACKUP_TABLES.map(t => t.name))

  return {
    migration: payload.migration,
    compatibility: compareMigrations(payload.migration, await latestMigration(tx)),
    sections: BACKUP_SECTIONS.map(section => ({
      key: section.key,
      rows: section.tables.reduce((sum, t) => sum + (payload.tables[t.name]?.length ?? 0), 0),
    })),
    unknownTables: Object.keys(payload.tables).filter(name => !known.has(name) || !present.has(name)).sort((a, b) => a.localeCompare(b)),
  }
}

interface ForeignKey {
  child: string
  parent: string
  childColumns: string[]
  parentColumns: string[]
}

async function foreignKeys(db: Db): Promise<ForeignKey[]> {
  const rows = await db.$queryRawUnsafe<{ child: string; parent: string; child_columns: string[]; parent_columns: string[] }[]>(
    `SELECT c1.relname AS child, c2.relname AS parent,
            ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(n, i)
                    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.i)::text[] AS child_columns,
            ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(n, i)
                    JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY u.i)::text[] AS parent_columns
       FROM pg_constraint k
       JOIN pg_class c1 ON c1.oid = k.conrelid
       JOIN pg_class c2 ON c2.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = c1.relnamespace
      WHERE k.contype = 'f' AND n.nspname = current_schema()`,
  )
  return rows.map(r => ({ child: r.child, parent: r.parent, childColumns: r.child_columns, parentColumns: r.parent_columns }))
}

function parentsOf(fks: ForeignKey[]): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>()
  for (const { child, parent } of fks) {
    if (!refs.has(child)) refs.set(child, new Set())
    refs.get(child)!.add(parent)
  }
  for (const spec of BACKUP_TABLES) {
    for (const parent of spec.after ?? []) {
      if (!refs.has(spec.name)) refs.set(spec.name, new Set())
      refs.get(spec.name)!.add(parent)
    }
  }
  return refs
}

async function primaryKeys(db: Db): Promise<Map<string, string>> {
  const rows = await db.$queryRawUnsafe<{ table_name: string; conname: string }[]>(
    `SELECT c.relname AS table_name, k.conname
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE k.contype = 'p' AND n.nspname = current_schema()`,
  )
  return new Map(rows.map(r => [r.table_name, r.conname]))
}

async function insertableColumns(db: Db): Promise<Map<string, { all: Set<string>; serial: string[] }>> {
  const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string; serial: boolean }[]>(
    `SELECT table_name, column_name,
            (column_default LIKE 'nextval(%' OR is_identity = 'YES') AS serial
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND is_generated = 'NEVER'`,
  )
  const columns = new Map<string, { all: Set<string>; serial: string[] }>()
  for (const r of rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, { all: new Set(), serial: [] })
    const entry = columns.get(r.table_name)!
    entry.all.add(r.column_name)
    if (r.serial) entry.serial.push(r.column_name)
  }
  return columns
}

interface InsertTarget {
  table: string
  columns: Set<string>
  primaryKey?: string
  importWhere?: string
}

async function insertRows(tx: Db, target: InsertTarget, rows: Row[]): Promise<number> {
  const keys = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) if (target.columns.has(key)) keys.add(key)
  if (keys.size === 0) return 0

  const names = [...keys].map(quote)
  const cols = names.join(', ')
  const where = target.importWhere ? ` WHERE ${target.importWhere}` : ''
  // Every other row was deleted first, so a conflict can only hit a row the
  // restore keeps (keepOnDelete): it takes the file's values.
  const upsert = target.primaryKey
    ? ` ON CONFLICT ON CONSTRAINT ${quote(target.primaryKey)} DO UPDATE SET ${names.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
    : ''
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = JSON.stringify(rows.slice(i, i + INSERT_CHUNK))
    inserted += await tx.$executeRawUnsafe(
      `INSERT INTO ${quote(target.table)} (${cols}) OVERRIDING SYSTEM VALUE
       SELECT ${cols} FROM json_populate_recordset(NULL::${quote(target.table)}, $1::json) AS r${where}${upsert}`,
      chunk,
    )
  }
  return inserted
}

// Rows outside the backup that hang off a restored table by a cascading
// foreign key: sessions on users, raised alerts on alert rules, the usage
// cache of a vDC. Deleting their parent would take them along, so they are
// set aside and put back once the restore is in, as long as their parent
// still exists. Restoring the install you are signed in to keeps you signed
// in, and the restore result reaches the screen.
interface Dependent {
  table: string
  copy: string
  checks: string[]
}

async function setDependentsAside(tx: Db, targets: string[], fks: ForeignKey[], present: Set<string>): Promise<Dependent[]> {
  const restored = new Set(targets)
  const byTable = new Map<string, ForeignKey[]>()
  for (const fk of fks) {
    if (restored.has(fk.parent) && !restored.has(fk.child) && present.has(fk.child)) {
      byTable.set(fk.child, [...(byTable.get(fk.child) ?? []), fk])
    }
  }

  const dependents: Dependent[] = []
  for (const [table, links] of byTable) {
    const copy = `_pcx_keep_${dependents.length}`
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${quote(copy)} ON COMMIT DROP AS SELECT * FROM ${quote(table)}`)
    const checks = links.map(fk => {
      const nullable = fk.childColumns.map(c => `k.${quote(c)} IS NULL`).join(' OR ')
      const match = fk.childColumns.map((c, i) => `p.${quote(fk.parentColumns[i])} = k.${quote(c)}`).join(' AND ')
      return `(${nullable} OR EXISTS (SELECT 1 FROM ${quote(fk.parent)} p WHERE ${match}))`
    })
    dependents.push({ table, copy, checks })
  }
  return dependents
}

async function putDependentsBack(tx: Db, dependents: Dependent[], columns: Map<string, { all: Set<string> }>) {
  for (const { table, copy, checks } of dependents) {
    const names = [...(columns.get(table)?.all ?? [])].map(quote)
    if (names.length === 0) continue
    await tx.$executeRawUnsafe(
      `INSERT INTO ${quote(table)} (${names.join(', ')}) OVERRIDING SYSTEM VALUE
       SELECT ${names.map(c => `k.${c}`).join(', ')} FROM ${quote(copy)} k
        WHERE ${checks.join(' AND ')}
       ON CONFLICT DO NOTHING`,
    )
  }
}

function deleteCondition(spec: BackupTable | undefined): string {
  const conditions = [spec?.exportWhere, spec?.keepOnDelete && `NOT (${spec.keepOnDelete})`].filter(Boolean)
  return conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
}

// Restored replication jobs come back paused: on a fresh install the target
// holds none of the replicas, and resuming them is the operator's call, not a
// side effect of a restore that would start full copies on its own.
async function pauseReplication(tx: Db, columns: Set<string> | undefined) {
  if (!columns?.has('status')) return
  const sets = [`status = 'paused'`]
  if (columns.has('run_holder')) sets.push(`run_holder = ''`)
  if (columns.has('run_heartbeat_at')) sets.push('run_heartbeat_at = NULL')
  await tx.$executeRawUnsafe(`UPDATE replication_jobs SET ${sets.join(', ')}`)
}

export function restoreConfiguration(db: PrismaClient, schema: string, payload: BackupPayload, encrypt: Encrypt): Promise<RestoreResult> {
  const sealed = sealSecrets(payload.tables, encrypt)
  const fileTables = sealed.value

  return inSchema(
    db,
    schema,
    async tx => {
      const present = await existingTables(tx)
      const columns = await insertableColumns(tx)
      const keys = await primaryKeys(tx)
      const specs = new Map(BACKUP_TABLES.map(t => [t.name, t]))

      // Only tables both in the file and on this install are replaced: a table
      // the file does not carry keeps its rows rather than being emptied.
      const targets = BACKUP_TABLES.map(t => t.name).filter(name => present.has(name) && name in fileTables)
      const fks = await foreignKeys(tx)
      const order = orderForInsert(targets, parentsOf(fks))
      const dependents = await setDependentsAside(tx, order, fks, present)

      for (const table of [...order].reverse()) {
        await tx.$executeRawUnsafe(`DELETE FROM ${quote(table)}${deleteCondition(specs.get(table))}`)
      }

      let rows = 0
      for (const table of order) {
        const tableColumns = columns.get(table)
        if (!tableColumns) continue
        rows += await insertRows(
          tx,
          { table, columns: tableColumns.all, primaryKey: keys.get(table), importWhere: specs.get(table)?.importWhere },
          fileTables[table],
        )
        for (const column of tableColumns.serial) {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${quote(column)}) FROM ${quote(table)}), 0) + 1, false)`,
            quote(table),
            column,
          )
        }
      }

      await putDependentsBack(tx, dependents, columns)

      if (order.includes('replication_jobs')) await pauseReplication(tx, columns.get('replication_jobs')?.all)

      return {
        tables: order.length,
        rows,
        secrets: sealed.count,
        skippedTables: Object.keys(fileTables).filter(name => !targets.includes(name)).sort((a, b) => a.localeCompare(b)),
      }
    },
    { timeout: 120_000 },
  )
}
