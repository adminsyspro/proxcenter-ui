import { DEFAULT_TENANT_ID, getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'

/**
 * Which Site Recovery jobs and plans a caller may see (ui#1394).
 *
 * A job or plan names its two clusters by connection id. Deleting a connection
 * left them behind in the orchestrator: still counted on the dashboard, but
 * hidden from every list and refused (404) by every route, so only SQL could
 * remove them. The provider sees the whole fleet (its connection set is every
 * connection), so an id outside that set can only be a deleted connection: the
 * item is shown flagged, and may be deleted. A tenant set is a subset of the
 * fleet, so a missing id may be another tenant's connection: hidden, as before.
 */

export type ReplicationEnd = 'source' | 'target'

export interface ReplicationScope {
  connectionIds: ReadonlySet<string>
  showOrphans: boolean
}

interface ClusterRefs {
  source_cluster?: string | null
  target_cluster?: string | null
}

export type Scoped<T> = T & { missing_connections?: ReplicationEnd[] }

export async function getReplicationScope(): Promise<ReplicationScope> {
  const [connectionIds, tenantId] = await Promise.all([getTenantConnectionIds(), getCurrentTenantId()])

  return { connectionIds, showOrphans: tenantId === DEFAULT_TENANT_ID }
}

export function missingConnections(item: ClusterRefs, connectionIds: ReadonlySet<string>): ReplicationEnd[] {
  const missing: ReplicationEnd[] = []

  if (item.source_cluster && !connectionIds.has(item.source_cluster)) missing.push('source')
  if (item.target_cluster && !connectionIds.has(item.target_cluster)) missing.push('target')

  return missing
}

/** The item as the caller may see it, or null when it is out of scope. */
export function scopeReplicationItem<T extends ClusterRefs>(item: T | null | undefined, scope: ReplicationScope): Scoped<T> | null {
  if (!item) return null
  const missing = missingConnections(item, scope.connectionIds)

  if (missing.length === 0) return item
  if (!scope.showOrphans) return null

  return { ...item, missing_connections: missing }
}

/**
 * For an [id] route: the item when the caller may act on it. An orphan can be
 * read and deleted, nothing else: its sync, edit or failover would only meet
 * the missing connection.
 */
export function itemForAction<T extends ClusterRefs>(
  item: T | null | undefined,
  scope: ReplicationScope,
  { allowOrphan }: { allowOrphan: boolean }
): Scoped<T> | null {
  const scoped = scopeReplicationItem(item, scope)

  if (!scoped || (scoped.missing_connections && !allowOrphan)) return null

  return scoped
}

export function scopeReplicationItems<T extends ClusterRefs>(items: T[] | null | undefined, scope: ReplicationScope): Scoped<T>[] {
  if (!Array.isArray(items)) return []

  return items.flatMap(item => {
    const scoped = scopeReplicationItem(item, scope)

    return scoped ? [scoped] : []
  })
}

export interface JobStatusSummary {
  synced: number
  syncing: number
  pending: number
  error: number
  paused: number
  no_match: number
  partial: number
}

/**
 * The dashboard counters over the jobs the caller can see, counted as the
 * orchestrator's GetHealth does (partial is an error too), so the figures
 * match the list under them.
 */
export function summarizeReplicationJobs(jobs: ReadonlyArray<{ status?: string }>): {
  job_summary: JobStatusSummary
  error_count: number
  total_jobs: number
} {
  const job_summary: JobStatusSummary = { synced: 0, syncing: 0, pending: 0, error: 0, paused: 0, no_match: 0, partial: 0 }

  for (const job of jobs) {
    const status = job.status as keyof JobStatusSummary | undefined

    if (status && status in job_summary) job_summary[status]++
  }

  return { job_summary, error_count: job_summary.error + job_summary.partial, total_jobs: jobs.length }
}

interface NamedClusterRefs extends ClusterRefs {
  id: string
  name?: string | null
}

/** Jobs and plans replicating from or to a connection, by display name. */
export function connectionUsers(
  connectionId: string,
  { jobs, plans }: { jobs: NamedClusterRefs[] | null | undefined; plans: NamedClusterRefs[] | null | undefined }
): { jobs: string[]; plans: string[] } {
  const names = (items: NamedClusterRefs[] | null | undefined) =>
    (items || [])
      .filter(item => item.source_cluster === connectionId || item.target_cluster === connectionId)
      .map(item => item.name || item.id)

  return { jobs: names(jobs), plans: names(plans) }
}
