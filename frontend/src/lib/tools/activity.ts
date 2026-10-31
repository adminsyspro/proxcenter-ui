/**
 * What happened on the estate: Proxmox tasks and configuration changes (#459).
 *
 * Both read the copies the orchestrator already keeps (task history #1225,
 * change journal), so a question costs no Proxmox call and still works for a
 * host that is down. The orchestrator knows no users: everything it returns
 * is filtered here on the RBAC- and vDC-filtered snapshot.
 *
 * Scoping rule, conservative on purpose: a record about a guest is kept when
 * that guest is in the snapshot; a record about a host alone (a package
 * update, a Ceph task) only when the host is in the snapshot AND nothing
 * restricts the caller, since on a shared-node vDC those are provider-only.
 * Changes also go through the journal's own tenant rule
 * (`isChangeVisibleToTenant`), which reads the pool stamped at write time: a
 * reused vmid must not hand a vDC tenant the history of the guest before.
 */

import { buildChangeVisibilityCtx, isChangeVisibleToTenant } from '@/lib/changes/visibility'
import { orchestratorFetch } from '@/lib/orchestrator/client'
import { fetchStoredTasks } from '@/lib/tasks/history'
import { taskFamily, taskStatusClass } from '@/lib/tasks/archive'

import type { InventorySnapshot } from './snapshot'
import {
  argEnum,
  argNumber,
  argString,
  resolveConnection,
  resolveGuest,
  resolveNode,
  type CatalogTool,
  type ToolContext,
} from './types'

/** The longest look back a question may ask for: 30 days. */
export const MAX_ACTIVITY_HOURS = 720

export function recordInSnapshot(
  record: { connectionId?: string | null; node?: string | null; vmid?: string | null },
  snapshot: InventorySnapshot
): boolean {
  if (!record.connectionId || !snapshot.clusters.some(c => c.id === record.connectionId)) return false

  // An unrestricted caller also sees the history of a guest deleted since,
  // which is the point of "who deleted db-01?".
  if (record.vmid) {
    return snapshot.restricted === false || snapshot.guests.some(g => g.connId === record.connectionId && g.vmid === String(record.vmid))
  }

  return (
    snapshot.restricted === false &&
    (!record.node || snapshot.nodes.some(n => n.connId === record.connectionId && n.name === record.node))
  )
}

function formatInstant(value: string | number | null | undefined, timeZone: string | undefined): string | null {
  if (value === null || value === undefined || value === '') return null

  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)

  if (Number.isNaN(date.getTime())) return null

  try {
    return (
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date) + (timeZone ? '' : ' UTC')
    )
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  }
}

/** Which connections, host and guest a model's filters name, resolved on the snapshot. */
function resolveFilters(args: Record<string, unknown>, ctx: ToolContext) {
  const clusterRef = argString(args, 'cluster')
  const nodeRef = argString(args, 'node')
  const guestRef = argString(args, 'guest')

  const guest = guestRef ? resolveGuest(ctx, guestRef) : null

  if (guest) return { guest, node: null, connectionIds: [guest.connId] }

  const node = nodeRef ? resolveNode(ctx, nodeRef, clusterRef) : null

  if (node) return { guest, node: node.node, connectionIds: [node.connection.id] }

  const connectionIds = clusterRef ? [resolveConnection(ctx, clusterRef).id] : ctx.snapshot.clusters.map(c => c.id)

  return { guest, node: null, connectionIds }
}

const nameOf = (snapshot: InventorySnapshot, connectionId: string, vmid: string | null | undefined) =>
  vmid ? snapshot.guests.find(g => g.connId === connectionId && g.vmid === String(vmid))?.name ?? null : null

const clusterName = (snapshot: InventorySnapshot, connectionId: string) =>
  snapshot.clusters.find(c => c.id === connectionId)?.name ?? null

/* ------------------------------------------------------------------ */
/* list_tasks                                                         */
/* ------------------------------------------------------------------ */

const TASK_STATUSES = ['failed', 'running', 'all'] as const
const TASK_FAMILIES = ['all', 'backup', 'migration', 'power', 'snapshot', 'ha', 'other'] as const

export const listTasksTool: CatalogTool = {
  name: 'list_tasks',
  readOnly: true,
  description:
    'Proxmox tasks of the last hours or days (backups, migrations, starts and stops, snapshots, HA), by default the FAILED ones, with the error line of each failure, or the ones RUNNING now. Answers "did last night\'s backups fail?", "which tasks failed this week?", "what is running right now?", "what ran on pve2 today?", "when was db-01 last migrated?". Example: family=\'backup\', hours=24 or status=\'all\', guest=\'db-01\', hours=168',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'failed (default, errors and warnings), running (in progress now) or all.', enum: [...TASK_STATUSES], default: 'failed' },
      family: {
        type: 'string',
        description: 'backup, migration, power (start, stop, reboot), snapshot, ha or other.',
        enum: [...TASK_FAMILIES],
        default: 'all',
      },
      hours: { type: 'integer', description: 'How far back to look, in hours. 24 = since yesterday, 168 = a week.', default: 24, minimum: 1, maximum: MAX_ACTIVITY_HOURS },
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      node: { type: 'string', description: 'Host name, for the tasks of one host.' },
      guest: { type: 'string', description: 'VM or container name or vmid, for the tasks of one guest.' },
      limit: { type: 'integer', description: 'How many tasks to return, newest first.', default: 30, minimum: 1, maximum: 100 },
    },
  },
  async execute(args, ctx) {
    const status = argEnum(args, 'status', TASK_STATUSES, 'failed')
    const family = argEnum(args, 'family', TASK_FAMILIES, 'all')
    const hours = argNumber(args, 'hours', 24, { min: 1, max: MAX_ACTIVITY_HOURS })
    const limit = argNumber(args, 'limit', 30, { min: 1, max: 100 })
    const { guest, node, connectionIds } = resolveFilters(args, ctx)

    const until = Math.floor(Date.now() / 1000)
    const stored = await fetchStoredTasks({
      connectionIds,
      since: until - hours * 3600,
      until,
      ...(node ? { nodes: [node.name] } : {}),
      ...(guest ? { vmid: guest.vmid, nodes: undefined } : {}),
      limit: 2000,
    })

    if (!stored) return { available: false, reason: 'The task history is not reachable right now.' }

    const tasks = stored.tasks
      .filter(t => recordInSnapshot({ connectionId: t.connectionId, node: t.node, vmid: t.guestId || null }, ctx.snapshot))
      .filter(t => family === 'all' || taskFamily(t.type) === family)
      .filter(t => {
        if (status === 'running') return !t.endTime

        return status === 'all' || ['error', 'warning'].includes(taskStatusClass(t.endTime ? t.status : undefined))
      })
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))

    return {
      hours,
      total: tasks.length,
      truncatedHistory: stored.truncated,
      byStatus: {
        ok: tasks.filter(t => t.endTime && taskStatusClass(t.status) === 'ok').length,
        failed: tasks.filter(t => t.endTime && taskStatusClass(t.status) === 'error').length,
        warnings: tasks.filter(t => t.endTime && taskStatusClass(t.status) === 'warning').length,
        running: tasks.filter(t => !t.endTime).length,
      },
      tasks: tasks.slice(0, limit).map(t => ({
        type: t.type,
        family: taskFamily(t.type),
        cluster: clusterName(ctx.snapshot, t.connectionId),
        node: t.node,
        guest: nameOf(ctx.snapshot, t.connectionId, t.guestId) ?? (t.guestId || null),
        user: t.user,
        started: formatInstant(t.startTime, ctx.timeZone),
        ended: formatInstant(t.endTime, ctx.timeZone),
        status: t.endTime ? t.status : 'running',
        // The last log line of a failure is what tells why; capped, a log
        // can be long.
        ...(t.endTime && taskStatusClass(t.status) !== 'ok' && t.logTail
          ? { error: t.logTail.trim().split('\n').slice(-2).join(' | ').slice(0, 300) }
          : {}),
      })),
    }
  },
}

/* ------------------------------------------------------------------ */
/* list_changes                                                       */
/* ------------------------------------------------------------------ */

type ChangeRow = {
  timestamp?: string
  connectionId?: string
  resourceType?: string
  resourceId?: string | number
  resourceName?: string
  action?: string
  user?: string
  node?: string
  fields?: Array<{ field?: string; oldValue?: unknown; newValue?: unknown }>
}

const GUEST_RESOURCE_TYPES = new Set(['vm', 'qemu', 'lxc', 'ct', 'guest'])

export const listChangesTool: CatalogTool = {
  name: 'list_changes',
  readOnly: true,
  description:
    'Configuration changes recorded by ProxCenter: who changed what on which VM or host, with the old and new values (CPU, memory, disks, network, snapshots, migrations, creations and deletions). Answers "what changed yesterday?", "who resized db-01?", "what was modified on pve1 this week?". Example: hours=24 or guest=\'db-01\', hours=168',
  parameters: {
    type: 'object',
    properties: {
      hours: { type: 'integer', description: 'How far back to look, in hours.', default: 24, minimum: 1, maximum: MAX_ACTIVITY_HOURS },
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      node: { type: 'string', description: 'Host name, for the changes on one host.' },
      guest: { type: 'string', description: 'VM or container name or vmid, for the changes of one guest.' },
      limit: { type: 'integer', description: 'How many changes to return, newest first.', default: 20, minimum: 1, maximum: 60 },
    },
  },
  async execute(args, ctx) {
    const hours = argNumber(args, 'hours', 24, { min: 1, max: MAX_ACTIVITY_HOURS })
    const limit = argNumber(args, 'limit', 20, { min: 1, max: 60 })
    const { guest, node, connectionIds } = resolveFilters(args, ctx)
    const from = new Date(Date.now() - hours * 3_600_000).toISOString()

    // One orchestrator read per visible connection: the journal has no user
    // notion, and the per-connection query keeps the limit from being spent
    // on another tenant's rows.
    const pages = await Promise.all(
      connectionIds.map(async connectionId => {
        const params = new URLSearchParams({ connectionId, from, limit: '500' })

        if (guest) params.set('resourceId', guest.vmid)
        if (node) params.set('node', node.name)

        try {
          const res = await orchestratorFetch<{ data?: ChangeRow[] }>(`/changes?${params}`, { timeout: 10_000 })

          return (Array.isArray(res?.data) ? res.data : []).map(c => ({ ...c, connectionId: c.connectionId || connectionId }))
        } catch {
          return null
        }
      })
    )

    if (pages.every(p => p === null)) return { available: false, reason: 'The change journal is not reachable right now.' }

    const visibility = await buildChangeVisibilityCtx()

    const changes = pages
      .flatMap(p => p ?? [])
      .filter(c => isChangeVisibleToTenant(c, visibility))
      .filter(c => {
        const isGuest = GUEST_RESOURCE_TYPES.has(String(c.resourceType || '').toLowerCase())

        return recordInSnapshot(
          { connectionId: c.connectionId, node: c.node ?? null, vmid: isGuest && c.resourceId !== undefined ? String(c.resourceId) : null },
          ctx.snapshot
        )
      })
      .sort((a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''))

    return {
      hours,
      total: changes.length,
      changes: changes.slice(0, limit).map(c => ({
        when: formatInstant(c.timestamp, ctx.timeZone),
        cluster: c.connectionId ? clusterName(ctx.snapshot, c.connectionId) : null,
        resource: c.resourceName || (c.resourceId !== undefined ? String(c.resourceId) : null),
        resourceType: c.resourceType ?? null,
        vmid: GUEST_RESOURCE_TYPES.has(String(c.resourceType || '').toLowerCase()) && c.resourceId !== undefined ? String(c.resourceId) : null,
        node: c.node ?? null,
        action: c.action ?? null,
        user: c.user ?? null,
        // Four short diffs per change keep 20 changes inside the result cap.
        fields: (c.fields ?? []).slice(0, 4).map(f => `${f.field ?? ''}: ${String(f.oldValue ?? '')} -> ${String(f.newValue ?? '')}`.slice(0, 90)),
      })),
    }
  },
}
