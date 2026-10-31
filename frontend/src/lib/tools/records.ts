/**
 * What ProxCenter records in its own database (#459): migration jobs, vDC
 * quotas and the daily health score. None of these tools calls Proxmox.
 *
 * Each one checks the permission its page asks for, reads through the session
 * Prisma client (tenant applied), and keeps only what the snapshot places in
 * the caller's scope.
 */

import { checkPermission, getAccessibleResources, getRBACContext, PERMISSIONS } from '@/lib/rbac'
import { filterVisibleVdcs, type VdcVisibilityGrant } from '@/lib/rbac/vdcVisibility'
import { getSessionPrisma } from '@/lib/tenant'
import { listVdcs } from '@/lib/vdc'

import { argEnum, argNumber, ToolScopeError, type CatalogTool } from './types'

async function requirePermission(permission: string, what: string) {
  if (await checkPermission(permission)) throw new ToolScopeError(`You do not have the permission to view ${what}.`)
}

const instant = (d: Date | null | undefined, timeZone: string | undefined) => {
  if (!d) return null

  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d) + (timeZone ? '' : ' UTC')
  } catch {
    return d.toISOString()
  }
}

const gb = (bytes: bigint | number | null | undefined) => (bytes === null || bytes === undefined ? null : Math.round(Number(bytes) / 1e8) / 10)

/* ------------------------------------------------------------------ */
/* list_migrations                                                    */
/* ------------------------------------------------------------------ */

const MIGRATION_STATES = ['all', 'running', 'failed', 'completed'] as const
const RUNNING = ['pending', 'preflight', 'creating_vm', 'transferring', 'configuring']

const STATE_FILTERS: Record<(typeof MIGRATION_STATES)[number], object> = {
  all: {},
  running: { status: { in: RUNNING } },
  failed: { status: 'failed' },
  completed: { status: 'completed' },
}

export const listMigrationsTool: CatalogTool = {
  name: 'list_migrations',
  readOnly: true,
  description:
    'Migration jobs into Proxmox (from VMware, Hyper-V, Nutanix, XCP-ng): state, current step, progress, data transferred and speed, error of a failed one. Answers "where is the migration of vm-x?", "which migrations failed?", "what is migrating right now?". Example: state=\'failed\'',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'running, failed, completed or all.', enum: [...MIGRATION_STATES], default: 'all' },
      limit: { type: 'integer', description: 'How many jobs, newest first.', default: 20, minimum: 1, maximum: 50 },
    },
  },
  async execute(args, ctx) {
    await requirePermission(PERMISSIONS.VM_MIGRATE, 'migrations')

    const state = argEnum(args, 'state', MIGRATION_STATES, 'all')
    const limit = argNumber(args, 'limit', 20, { min: 1, max: 50 })
    const prisma = await getSessionPrisma()
    const where = STATE_FILTERS[state]

    const rows = await prisma.migrationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        sourceVmName: true,
        sourceHost: true,
        targetConnectionId: true,
        targetNode: true,
        targetStorage: true,
        targetVmid: true,
        status: true,
        currentStep: true,
        progress: true,
        bytesTransferred: true,
        totalBytes: true,
        transferSpeed: true,
        error: true,
        startedAt: true,
        completedAt: true,
      },
    })

    // The target cluster must be visible, and its host too for a restricted
    // caller: a job names the node it lands on.
    const visible = rows.filter(
      j =>
        ctx.snapshot.clusters.some(c => c.id === j.targetConnectionId) &&
        (ctx.snapshot.restricted === false || ctx.snapshot.nodes.some(n => n.connId === j.targetConnectionId && n.name === j.targetNode))
    )

    return {
      total: visible.length,
      running: visible.filter(j => RUNNING.includes(j.status)).length,
      failed: visible.filter(j => j.status === 'failed').length,
      completed: visible.filter(j => j.status === 'completed').length,
      cancelled: visible.filter(j => j.status === 'cancelled').length,
      jobs: visible.slice(0, limit).map(j => ({
        guest: j.sourceVmName,
        sourceHost: j.sourceHost,
        targetCluster: ctx.snapshot.clusters.find(c => c.id === j.targetConnectionId)?.name ?? null,
        targetNode: j.targetNode,
        targetStorage: j.targetStorage,
        targetVmid: j.targetVmid,
        status: j.status,
        step: j.currentStep,
        progressPct: j.progress,
        transferredGb: gb(j.bytesTransferred),
        totalGb: gb(j.totalBytes),
        speed: j.transferSpeed,
        started: instant(j.startedAt, ctx.timeZone),
        completed: instant(j.completedAt, ctx.timeZone),
        ...(j.error ? { error: j.error.slice(0, 240) } : {}),
      })),
    }
  },
}

/* ------------------------------------------------------------------ */
/* get_vdc_quotas                                                     */
/* ------------------------------------------------------------------ */

const pctOf = (used: number, max: number | null) => (max && max > 0 ? Math.round((used / max) * 1000) / 10 : null)

export const getVdcQuotasTool: CatalogTool = {
  name: 'get_vdc_quotas',
  readOnly: true,
  description:
    'Quotas of the virtual datacenters (vDC) the user may see: vCPUs, RAM, storage, VMs, snapshots and backups used against the limit, and what is left. Answers "how much is left on my vDC?", "am I close to my RAM quota?". Example: (no argument)',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    await requirePermission(PERMISSIONS.VM_VIEW, 'vDCs')

    // The vDC landing's visibility rule, word for word: admins and API
    // tokens see the tenant's vDCs, a user only those a grant maps to.
    let grants: VdcVisibilityGrant[] | null = null

    try {
      const rbacCtx = await getRBACContext()

      if (rbacCtx && !rbacCtx.isAdmin && rbacCtx.userId) {
        grants = await getAccessibleResources(rbacCtx.userId, PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
      }
    } catch {
      grants = null
    }

    // The usage is the cached one, refreshed by the vDC pages and the
    // sampler: refreshing it here would cost Proxmox calls per question.
    const vdcs = filterVisibleVdcs(await listVdcs(ctx.tenantId), grants)

    if (vdcs.length === 0) return { vdcs: [], note: 'No virtual datacenter is visible to you.' }

    return {
      vdcs: vdcs.map(v => {
        const q = v.quota
        const u = v.usage
        const line = (used: number, max: number | null | undefined) => ({ used, limit: max ?? null, usedPct: pctOf(used, max ?? null), left: max ? Math.max(0, max - used) : null })

        return {
          name: v.name,
          cluster: v.connectionName ?? null,
          enabled: v.enabled,
          usageAsOf: u?.lastSyncedAt ? instant(new Date(u.lastSyncedAt), ctx.timeZone) : null,
          vcpus: line(u?.usedVcpus ?? 0, q?.maxVcpus),
          ramGb: line(Math.round((u?.usedRamMb ?? 0) / 102.4) / 10, q?.maxRamMb ? Math.round(q.maxRamMb / 102.4) / 10 : null),
          storageGb: line(Math.round((u?.usedStorageMb ?? 0) / 102.4) / 10, q?.maxStorageMb ? Math.round(q.maxStorageMb / 102.4) / 10 : null),
          vms: line(u?.usedVms ?? 0, q?.maxVms),
          snapshots: line(u?.usedSnapshots ?? 0, q?.maxSnapshots),
          backups: line(u?.usedBackups ?? 0, q?.maxBackups),
        }
      }),
      note: 'A null limit means no quota on that resource.',
    }
  },
}

/* ------------------------------------------------------------------ */
/* get_health_trend                                                   */
/* ------------------------------------------------------------------ */

export const getHealthTrendTool: CatalogTool = {
  name: 'get_health_trend',
  readOnly: true,
  description:
    'The daily health score of the infrastructure (0 to 100) with CPU, RAM and storage usage per day, over the last days, and whether it is improving or degrading. Answers "is the health of my infrastructure degrading?", "how has storage usage evolved this month?". Example: days=30',
  parameters: {
    type: 'object',
    properties: { days: { type: 'integer', description: 'How many days back.', default: 30, minimum: 2, maximum: 180 } },
  },
  async execute(args, ctx) {
    // The score is computed over the whole tenant: a caller limited to part
    // of it would read figures about hosts it cannot see.
    if (ctx.snapshot.restricted !== false) {
      throw new ToolScopeError('The health score covers the whole infrastructure and is only shown to users who see all of it.')
    }

    const days = argNumber(args, 'days', 30, { min: 2, max: 180 })
    const prisma = await getSessionPrisma()
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

    const rows = await prisma.healthScoreHistory.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, score: true, cpuPct: true, ramPct: true, storagePct: true },
    })

    if (rows.length === 0) return { days, points: 0, note: 'No health score has been recorded for this period yet.' }

    const first = rows[0]
    const last = rows[rows.length - 1]
    const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)

    return {
      days,
      points: rows.length,
      from: first.date,
      to: last.date,
      scoreChange: last.score - first.score,
      storageChangePoints: first.storagePct !== null && last.storagePct !== null ? round(last.storagePct - first.storagePct) : null,
      lowest: rows.reduce((min, r) => (r.score < min.score ? r : min), first),
      daily: rows.slice(-31).map(r => ({ date: r.date, score: r.score, cpuPct: round(r.cpuPct), ramPct: round(r.ramPct), storagePct: round(r.storagePct) })),
    }
  },
}
