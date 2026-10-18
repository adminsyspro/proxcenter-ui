/**
 * Migration statistics over the whole history (roadmap#53): counts per status
 * and the bytes the completed migrations moved, per source connection and per
 * hypervisor type. The dashboards used to count the 50 jobs of the list route,
 * so older migrations dropped out of "Migrated" and "Data Transferred".
 *
 * Shared by GET /api/v1/migrations/stats and the inventory dashboards: no
 * server import here.
 */

export interface MigrationStats {
  completed: number
  failed: number
  cancelled: number
  queued: number
  /** Started and not finished. */
  inProgress: number
  /** What the completed migrations copied (bytesTransferred). */
  bytesTransferred: number
}

export interface MigrationStatsPayload {
  bySource: Record<string, MigrationStats>
  byType: Record<string, MigrationStats>
}

/** One row of `migrationJob.groupBy({ by: ["sourceConnectionId", "status"] })`. */
export interface MigrationStatsRow {
  sourceConnectionId: string
  status: string
  _count: { _all: number }
  _sum: { bytesTransferred: bigint | number | null }
}

export const emptyMigrationStats = (): MigrationStats => ({ completed: 0, failed: 0, cancelled: 0, queued: 0, inProgress: 0, bytesTransferred: 0 })

function add(into: MigrationStats, status: string, count: number, bytes: number) {
  if (status === "completed") { into.completed += count; into.bytesTransferred += bytes }
  else if (status === "failed") into.failed += count
  else if (status === "cancelled") into.cancelled += count
  else if (status === "queued") into.queued += count
  else into.inProgress += count
}

/** Fold the grouped rows of the visible sources (`typeById`) into per-source and per-type figures. */
export function aggregateMigrationStats(rows: MigrationStatsRow[], typeById: Map<string, string>): MigrationStatsPayload {
  const out: MigrationStatsPayload = { bySource: {}, byType: {} }
  for (const r of rows) {
    const type = typeById.get(r.sourceConnectionId)
    if (!type) continue
    const count = r._count?._all ?? 0
    const bytes = Number(r._sum?.bytesTransferred ?? 0) || 0
    add(out.bySource[r.sourceConnectionId] ??= emptyMigrationStats(), r.status, count, bytes)
    add(out.byType[type] ??= emptyMigrationStats(), r.status, count, bytes)
  }
  return out
}

/** The sum over some sources (a host page: one; a hypervisor-type page: its hosts). */
export function sumMigrationStats(bySource: Record<string, MigrationStats> | undefined, ids: Iterable<string>): MigrationStats {
  const out = emptyMigrationStats()
  for (const id of ids) {
    const s = bySource?.[id]
    if (!s) continue
    out.completed += s.completed; out.failed += s.failed; out.cancelled += s.cancelled
    out.queued += s.queued; out.inProgress += s.inProgress; out.bytesTransferred += s.bytesTransferred
  }
  return out
}
