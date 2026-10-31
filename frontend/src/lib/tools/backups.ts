/**
 * get_backup_coverage: which guests no backup job protects (#459).
 *
 * Same resolver as the Backups page (`resolveBackupCoverage`, roadmap#48), fed
 * with the guests of the RBAC- and vDC-filtered snapshot and one
 * `/cluster/backup` read per visible cluster, cached a minute. The page's
 * creation-time lookups (one config read per uncovered guest) are left out:
 * that fan-out is not worth a chat answer, so a guest created within the grace
 * period is listed rather than skipped, and the answer says so.
 */

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getSetting } from '@/lib/db/settings'
import {
  coverageSettingsFromThresholds,
  resolveBackupCoverage,
  type CoverageGuest,
  type VzdumpJob,
} from '@/lib/backups/coverage'

import { argNumber, argString, resolveConnection, type CatalogTool, type ToolContext } from './types'

export const BACKUP_JOBS_CACHE_TTL_MS = 60_000

const jobsCache = new Map<string, { at: number; jobs: Promise<VzdumpJob[]> }>()

/** Test hook: the cache is module state. */
export function clearBackupJobsCache() {
  jobsCache.clear()
}

/** The cluster's vzdump jobs, one `/cluster/backup` read per tenant and cluster a minute. */
export function loadBackupJobs(ctx: ToolContext, connId: string): Promise<VzdumpJob[]> {
  const key = `${ctx.tenantId}|${connId}`
  const hit = jobsCache.get(key)

  if (hit && Date.now() - hit.at < BACKUP_JOBS_CACHE_TTL_MS) return hit.jobs

  const jobs = getConnectionById(connId, ctx.tenantId)
    .then(conn => pveFetch<VzdumpJob[]>(conn, '/cluster/backup'))
    .then(list => (Array.isArray(list) ? list : []))

  jobsCache.set(key, { at: Date.now(), jobs })
  jobs.catch(() => {
    if (jobsCache.get(key)?.jobs === jobs) jobsCache.delete(key)
  })

  return jobs
}

const REASONS: Record<string, string> = {
  no_job: 'no backup job exists on this cluster',
  not_selected: 'no job selects it',
  excluded: 'excluded from an all-guests job',
  other_node: 'its job is pinned to another host',
  disabled_job: 'only a disabled job selects it',
}

function groupUncovered(guests: Array<CoverageGuest & { reason: string }>) {
  const groups = new Map<string, { cluster: string; reason: string; guests: string[] }>()

  for (const g of guests) {
    const key = `${g.connId}|${g.reason}`
    const group = groups.get(key) ?? { cluster: g.connectionName ?? g.connId, reason: REASONS[g.reason] ?? g.reason, guests: [] }

    group.guests.push(`${g.name} (${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid}, ${g.node})`)
    groups.set(key, group)
  }

  return [...groups.values()]
}

/**
 * Coverage of the snapshot's guests on these clusters, as the Backups page
 * resolves it. Shared with the remediation plan of the assistant
 * (roadmap#188), which turns the uncovered guests into backup_add steps.
 */
export async function computeBackupCoverage(ctx: ToolContext, connections: Array<{ id: string; name: string }>) {
  const settings = coverageSettingsFromThresholds(await getSetting('alert_thresholds', ctx.tenantId))
  const jobsByConnection: Record<string, VzdumpJob[]> = {}
  const unreadable: string[] = []

  await Promise.all(
    connections.map(async c => {
      try {
        jobsByConnection[c.id] = await loadBackupJobs(ctx, c.id)
      } catch {
        unreadable.push(c.name)
      }
    })
  )

  // A cluster whose jobs cannot be read contributes nothing: without its
  // jobs every guest would look unprotected.
  const guests: CoverageGuest[] = ctx.snapshot.guests
    .filter(g => g.connId in jobsByConnection)
    .map(g => ({
      connId: g.connId,
      connectionName: g.cluster,
      node: g.node,
      vmid: g.vmid,
      type: g.kind,
      name: g.name,
      status: g.status,
      template: g.template,
      tags: (g.tags || '').split(/[;,]/).map(t => t.trim()).filter(Boolean),
      pool: g.pool ?? null,
    }))

  const { uncovered, summary } = resolveBackupCoverage({ guests, jobsByConnection, settings, now: Date.now() })

  return { uncovered, summary, settings, unreadable, jobsByConnection }
}

export const getBackupCoverageTool: CatalogTool = {
  name: 'get_backup_coverage',
  readOnly: true,
  description:
    'Which VMs and containers no Proxmox backup job protects, and why (no job, excluded, job pinned to another host, job disabled). Answers "which VMs are not backed up?", "is db-01 covered by a backup job?". For whether a backup actually ran or failed, use the task history instead. Example: cluster=\'PVE-PROD\'',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      limit: { type: 'integer', description: 'How many unprotected guests to list.', default: 60, minimum: 1, maximum: 150 },
    },
  },
  async execute(args, ctx) {
    const limit = argNumber(args, 'limit', 60, { min: 1, max: 150 })
    const clusterRef = argString(args, 'cluster')
    const connections = clusterRef ? [resolveConnection(ctx, clusterRef)] : ctx.snapshot.clusters.map(c => ({ id: c.id, name: c.name }))

    const { uncovered, summary, settings, unreadable } = await computeBackupCoverage(ctx, connections)

    return {
      checked: summary.total,
      protected: summary.covered,
      unprotected: summary.uncovered,
      ignoredTemplates: summary.ignored.template,
      ignoredByOptOutTag: summary.ignored.tag,
      optOutTag: settings.excludeTag || null,
      ...(unreadable.length ? { clustersNotChecked: unreadable } : {}),
      // Grouped by cluster and reason, one short label per guest: 65
      // unprotected guests listed one object each overflowed the result cap.
      unprotectedByCluster: groupUncovered(uncovered.slice(0, limit)),
      ...(uncovered.length > limit ? { notListed: uncovered.length - limit } : {}),
      note: 'Recently created guests are listed too: the grace period is not applied here.',
    }
  },
}
