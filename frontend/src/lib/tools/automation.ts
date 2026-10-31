/**
 * DRS and Site Recovery, as the orchestrator already knows them (#459).
 *
 * Both read the orchestrator, never Proxmox. Both are Enterprise features and
 * sit behind `AUTOMATION_VIEW`, so each tool checks the licence and the
 * permission itself, the way their pages do. The orchestrator answers for the
 * whole estate: every row is then filtered on the RBAC- and vDC-filtered
 * snapshot, guests and hosts included, and the global KPIs it computes are
 * never relayed (they count other tenants' jobs); figures are recomputed from
 * the rows the caller may see.
 */

import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

import type { InventorySnapshot } from './snapshot'
import { argString, resolveConnection, ToolScopeError, type CatalogTool } from './types'

/** The licence and the permission the pages ask for, as a tool refusal. */
export async function requireAutomationAccess(feature: string, featureName: string) {
  if (!(await hasServerFeature(feature))) {
    throw new ToolScopeError(`${featureName} is not part of this ProxCenter licence.`)
  }

  if (await checkPermission(PERMISSIONS.AUTOMATION_VIEW, 'global', '*')) {
    throw new ToolScopeError(`You do not have the permission to view ${featureName}.`)
  }
}

const guestVisible = (snapshot: InventorySnapshot, connId: string, vmid: unknown) =>
  snapshot.guests.some(g => g.connId === connId && g.vmid === String(vmid))

const nodeVisible = (snapshot: InventorySnapshot, connId: string, node: unknown) =>
  typeof node === 'string' && snapshot.nodes.some(n => n.connId === connId && n.name === node)

const clusterName = (snapshot: InventorySnapshot, connId: string) => snapshot.clusters.find(c => c.id === connId)?.name ?? null

const spread = (values: number[]) => (values.length > 1 ? Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10 : 0)

function since(iso: unknown, timeZone: string | undefined): string | null {
  if (typeof iso !== 'string' || !iso) return null

  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return null

  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date) + (timeZone ? '' : ' UTC')
  } catch {
    return iso
  }
}

/* ------------------------------------------------------------------ */
/* get_drs_status                                                     */
/* ------------------------------------------------------------------ */

export const getDrsStatusTool: CatalogTool = {
  name: 'get_drs_status',
  readOnly: true,
  description:
    'The DRS (load balancer) state: whether it is on and in which mode, the migrations it recommends and why, the migrations it is running, and how unbalanced each cluster is (gap between the most and least loaded host). Answers "what does DRS recommend?", "is my cluster balanced?", "why does DRS want to move db-01?". Example: cluster=\'PVE-PROD\'',
  parameters: {
    type: 'object',
    properties: { cluster: { type: 'string', description: 'Cluster name, only when the user names one.' } },
  },
  async execute(args, ctx) {
    await requireAutomationAccess(Features.DRS, 'DRS')

    const clusterRef = argString(args, 'cluster')
    const connIds = clusterRef ? [resolveConnection(ctx, clusterRef).id] : ctx.snapshot.clusters.map(c => c.id)
    const client = getOrchestratorClient()

    const [statusRes, recsRes, migsRes] = await Promise.all([
      client.getDRSStatus().catch(() => null),
      client.getRecommendations(false).catch(() => null),
      client.getActiveMigrations().catch(() => null),
    ])

    if (!statusRes && !recsRes) return { available: false, reason: 'The DRS service is not reachable right now.' }

    // A recommendation names a guest and two hosts: kept only when all three
    // are visible, so it never reveals a host or a guest out of scope.
    const visibleMove = (r: any) =>
      connIds.includes(r?.connection_id) &&
      guestVisible(ctx.snapshot, r.connection_id, r.vmid) &&
      nodeVisible(ctx.snapshot, r.connection_id, r.source_node) &&
      nodeVisible(ctx.snapshot, r.connection_id, r.target_node)

    const recs = (Array.isArray(recsRes?.data) ? recsRes.data : []).filter(visibleMove)
    const migs = (Array.isArray(migsRes?.data) ? migsRes.data : []).filter(visibleMove)
    const status: any = statusRes?.data ?? {}

    return {
      enabled: Boolean(status.enabled),
      mode: status.mode ?? null,
      recommendations: recs
        .filter((r: any) => r.status === 'pending' || r.status === 'approved')
        .slice(0, 20)
        .map((r: any) => ({
          guest: r.vm_name,
          vmid: String(r.vmid),
          cluster: clusterName(ctx.snapshot, r.connection_id),
          from: r.source_node,
          to: r.target_node,
          priority: r.priority,
          reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : null,
          status: r.status,
          maintenanceEvacuation: Boolean(r.maintenance_evacuation),
        })),
      runningMigrations: migs
        .filter((m: any) => m.status === 'running')
        .map((m: any) => ({ guest: m.vm_name, from: m.source_node, to: m.target_node, started: since(m.started_at, ctx.timeZone) })),
      balance: connIds.map(connId => {
        const online = ctx.snapshot.nodes.filter(n => n.connId === connId && n.status === 'online')

        return {
          cluster: clusterName(ctx.snapshot, connId),
          hosts: online.length,
          ramSpreadPoints: spread(online.map(n => n.memPct)),
          cpuSpreadPoints: spread(online.map(n => n.cpuPct)),
          busiestRamHost: [...online].sort((a, b) => b.memPct - a.memPct)[0]?.name ?? null,
        }
      }),
      note: 'ramSpreadPoints is the gap, in percentage points, between the most and least RAM-loaded host: under 20 is balanced.',
    }
  },
}

/* ------------------------------------------------------------------ */
/* get_site_recovery_status                                           */
/* ------------------------------------------------------------------ */

export const getSiteRecoveryTool: CatalogTool = {
  name: 'get_site_recovery_status',
  readOnly: true,
  description:
    'Site Recovery (disaster recovery replication between clusters): each replication job with its state, how long ago it last synced against its RPO target, whether it meets that RPO, its error if any, and the VMs it protects. Answers "is my DR replication up to date?", "which replication jobs are in error?", "is db-01 protected on the DR site?". Example: (no argument) or cluster=\'PVE-PROD\'',
  parameters: {
    type: 'object',
    properties: { cluster: { type: 'string', description: 'Source or target cluster name, only when the user names one.' } },
  },
  async execute(args, ctx) {
    await requireAutomationAccess(Features.CEPH_REPLICATION, 'Site Recovery')

    const clusterRef = argString(args, 'cluster')
    const only = clusterRef ? resolveConnection(ctx, clusterRef).id : null
    const res = await getOrchestratorClient().getReplicationJobs().catch(() => null)

    if (!res) return { available: false, reason: 'The Site Recovery service is not reachable right now.' }

    const visibleCluster = (id: unknown) => typeof id === 'string' && ctx.snapshot.clusters.some(c => c.id === id)
    const now = Date.now()

    const jobs = (Array.isArray(res.data) ? res.data : [])
      .filter((j: any) => visibleCluster(j.source_cluster) && visibleCluster(j.target_cluster))
      .filter((j: any) => !only || j.source_cluster === only || j.target_cluster === only)
      // A job names its guests: a restricted caller sees it only when every
      // one of them is a guest of the snapshot.
      .filter((j: any) =>
        ctx.snapshot.restricted === false ||
        (Array.isArray(j.vm_ids) && j.vm_ids.every((vmid: unknown) => guestVisible(ctx.snapshot, j.source_cluster, vmid)))
      )
      .map((j: any) => {
        const lastSync = typeof j.last_sync === 'string' ? Date.parse(j.last_sync) : Number.NaN
        const lagSeconds = Number.isFinite(lastSync) ? Math.max(0, Math.round((now - lastSync) / 1000)) : null
        const rpo = typeof j.rpo_target === 'number' && j.rpo_target > 0 ? j.rpo_target : null

        return {
          name: j.name,
          status: j.status,
          from: clusterName(ctx.snapshot, j.source_cluster),
          to: clusterName(ctx.snapshot, j.target_cluster),
          guests: Array.isArray(j.vm_names) ? j.vm_names.slice(0, 20) : [],
          lastSync: since(j.last_sync, ctx.timeZone),
          minutesSinceLastSync: lagSeconds === null ? null : Math.round(lagSeconds / 60),
          rpoTargetMinutes: rpo === null ? null : Math.round(rpo / 60),
          meetsRpo: rpo === null || lagSeconds === null ? null : lagSeconds <= rpo,
          ...(j.error_message ? { error: String(j.error_message).slice(0, 200) } : {}),
          ...(j.status === 'syncing' ? { progressPct: j.progress_percent ?? null } : {}),
        }
      })

    return {
      jobs: jobs.length,
      inError: jobs.filter((j: any) => j.status === 'error').length,
      missingRpo: jobs.filter((j: any) => j.meetsRpo === false).length,
      protectedGuests: jobs.reduce((sum: number, j: any) => sum + j.guests.length, 0),
      replicationJobs: jobs.slice(0, 30),
    }
  },
}

