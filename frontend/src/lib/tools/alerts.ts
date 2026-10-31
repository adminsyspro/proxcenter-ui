/**
 * Active alerts, scoped to what the caller may see (#459).
 *
 * ProxCenter's alert table is per tenant only: an alert names its entity
 * (a host, a cluster, a PBS server) but carries no RBAC or vDC scope. Read
 * as-is, the assistant handed a vDC tenant or a user limited to one host
 * the alerts of the whole estate. Two gates close that:
 * - the `ALERTS_VIEW` permission, the one the alerts page asks for;
 * - the RBAC- and vDC-filtered snapshot: an alert is kept only when its
 *   host, guest or cluster is in it. An alert the snapshot cannot place
 *   (a PBS server) is kept only for a caller nothing restricts.
 *
 * The table is ProxCenter's own: reading it costs no Proxmox call.
 */

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getSessionPrisma } from '@/lib/tenant'
import type { InventorySnapshot } from '@/lib/tools/snapshot'
import { argEnum, argNumber, argString, resolveConnection, resolveNode, type CatalogTool } from '@/lib/tools/types'

export type ScopedAlert = {
  severity: string
  message: string
  source: string
  entityType: string | null
  entityId: string | null
  entityName: string | null
  metric: string | null
  currentValue: number | null
  threshold: number | null
  status: string
  firstSeenAt: Date
  lastSeenAt: Date
}

const GUEST_ENTITY_TYPES = new Set(['vm', 'qemu', 'lxc', 'ct', 'guest'])

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/** Whether the snapshot shows the entity an alert is about. */
export function alertInSnapshot(alert: Pick<ScopedAlert, 'entityType' | 'entityId' | 'entityName' | 'source'>, snapshot: InventorySnapshot): boolean {
  const type = (alert.entityType || '').toLowerCase()

  if (type === 'node') {
    // `source` is the cluster name; a host name alone can exist in two clusters.
    return snapshot.nodes.some(
      n => (same(n.name, alert.entityId) || same(n.name, alert.entityName)) && (!alert.source || same(n.cluster, alert.source))
    )
  }

  if (type === 'cluster') {
    return snapshot.clusters.some(c => c.id === alert.entityId || same(c.name, alert.entityName))
  }

  if (GUEST_ENTITY_TYPES.has(type)) {
    return snapshot.guests.some(
      g => (g.vmid === alert.entityId || same(g.name, alert.entityName)) && (!alert.source || same(g.cluster, alert.source))
    )
  }

  return snapshot.restricted === false
}

/**
 * The active alerts the caller may see, newest first. Empty without the
 * alerts permission or when the table cannot be read.
 */
export async function loadScopedAlerts(
  snapshot: InventorySnapshot,
  opts: { limit?: number; status?: string[] } = {}
): Promise<ScopedAlert[]> {
  try {
    if (await checkPermission(PERMISSIONS.ALERTS_VIEW)) return []

    const prisma = await getSessionPrisma()

    // Read past the limit: rows outside the caller's scope are dropped after.
    const rows: ScopedAlert[] = await prisma.alert.findMany({
      where: { status: { in: opts.status ?? ['active'] } },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
      select: {
        severity: true,
        message: true,
        source: true,
        entityType: true,
        entityId: true,
        entityName: true,
        metric: true,
        currentValue: true,
        threshold: true,
        status: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    })

    return rows.filter(a => alertInSnapshot(a, snapshot)).slice(0, opts.limit ?? 100)
  } catch (e) {
    console.error('[ai] Failed to get alerts:', e)

    return []
  }
}

const SEVERITIES = ['all', 'crit', 'warn', 'info'] as const
const STATUSES = ['active', 'acknowledged', 'resolved', 'all'] as const

const iso = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

export const listAlertsTool: CatalogTool = {
  name: 'list_alerts',
  readOnly: true,
  description:
    'The ProxCenter alerts the user may see, filtered by severity, status, cluster or host, with when each one started. Answers "are there critical alerts?", "which alerts concern pve2?", "what was resolved recently?". Example: severity=\'crit\' or node=\'pve2\', status=\'all\'',
  parameters: {
    type: 'object',
    properties: {
      severity: { type: 'string', description: 'crit, warn or info.', enum: [...SEVERITIES], default: 'all' },
      status: {
        type: 'string',
        description: 'active (default), acknowledged, resolved or all.',
        enum: [...STATUSES],
        default: 'active',
      },
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      node: { type: 'string', description: 'Host name, for the alerts of one host.' },
      limit: { type: 'integer', description: 'How many alerts to return, newest first.', default: 30, minimum: 1, maximum: 100 },
    },
  },
  async execute(args, ctx) {
    const severity = argEnum(args, 'severity', SEVERITIES, 'all')
    const status = argEnum(args, 'status', STATUSES, 'active')
    const limit = argNumber(args, 'limit', 30, { min: 1, max: 100 })
    const clusterRef = argString(args, 'cluster')
    const nodeRef = argString(args, 'node')

    // Resolved against the snapshot like every filter a model passes.
    const cluster = clusterRef ? resolveConnection(ctx, clusterRef) : null
    const node = nodeRef ? resolveNode(ctx, nodeRef, clusterRef).node : null

    const scoped = await loadScopedAlerts(ctx.snapshot, {
      limit: 500,
      status: status === 'all' ? ['active', 'acknowledged', 'resolved'] : [status],
    })

    const matching = scoped.filter(a => {
      if (severity !== 'all' && a.severity !== severity) return false
      if (cluster && !same(a.source, cluster.name) && a.entityId !== cluster.id) return false
      if (node && !(a.entityType === 'node' && (same(a.entityId, node.name) || same(a.entityName, node.name)))) return false

      return true
    })

    return {
      total: matching.length,
      bySeverity: Object.fromEntries(['crit', 'warn', 'info'].map(s => [s, matching.filter(a => a.severity === s).length])),
      alerts: matching.slice(0, limit).map(a => ({
        severity: a.severity,
        status: a.status,
        message: a.message,
        entity: a.entityName || a.entityId,
        entityType: a.entityType,
        cluster: a.source,
        metric: a.metric,
        value: a.currentValue,
        threshold: a.threshold,
        sinceUtc: iso(a.firstSeenAt),
        lastSeenUtc: iso(a.lastSeenAt),
      })),
    }
  },
}
