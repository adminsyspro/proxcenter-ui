// PostgreSQL as the application sees it: size, connections, cache efficiency
// and the tables by size. Plain catalogue and statistics views, readable by
// the application role, in the schema the application uses.

import { prisma } from '@/lib/db/prisma'

import type { DatabaseInfo, DatabaseTable } from './types'

interface ServerRow {
  version: string
  started_at: Date | null
  size_bytes: number
  max_connections: number
  in_recovery: boolean
  connections: number
  active: number
  blks_hit: number
  blks_read: number
  deadlocks: number
}

interface TableRow {
  name: string
  total_bytes: number
  rows: number
  dead_rows: number
  last_vacuum: Date | null
}

export function cacheHitPercent(hit: number, read: number): number | null {
  const total = hit + read

  return total > 0 ? (hit / total) * 100 : null
}

export function toTable(row: TableRow): DatabaseTable {
  return {
    name: row.name,
    totalBytes: Number(row.total_bytes),
    // reltuples is -1 until the table is analysed for the first time.
    rows: Number(row.rows) >= 0 ? Number(row.rows) : null,
    deadRows: Number(row.dead_rows),
    lastVacuum: row.last_vacuum ? new Date(row.last_vacuum).toISOString() : null
  }
}

export async function readDatabase(): Promise<DatabaseInfo> {
  const [server] = await prisma.$queryRaw<ServerRow[]>`
    SELECT
      current_setting('server_version') AS version,
      pg_postmaster_start_time() AS started_at,
      pg_database_size(current_database())::float8 AS size_bytes,
      current_setting('max_connections')::int AS max_connections,
      pg_is_in_recovery() AS in_recovery,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active,
      d.blks_hit::float8 AS blks_hit,
      d.blks_read::float8 AS blks_read,
      d.deadlocks::float8 AS deadlocks
    FROM pg_stat_database d
    WHERE d.datname = current_database()`

  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT
      c.relname AS name,
      pg_total_relation_size(c.oid)::float8 AS total_bytes,
      c.reltuples::float8 AS rows,
      coalesce(s.n_dead_tup, 0)::float8 AS dead_rows,
      greatest(s.last_autovacuum, s.last_vacuum) AS last_vacuum
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r' AND n.nspname = current_schema()
    ORDER BY pg_total_relation_size(c.oid) DESC, c.relname`

  return {
    version: server.version,
    startedAt: server.started_at ? new Date(server.started_at).toISOString() : null,
    sizeBytes: Number(server.size_bytes),
    connections: server.connections,
    activeConnections: server.active,
    maxConnections: server.max_connections,
    cacheHitPercent: cacheHitPercent(Number(server.blks_hit), Number(server.blks_read)),
    deadlocks: Number(server.deadlocks),
    inRecovery: server.in_recovery,
    tables: tables.map(toTable)
  }
}
