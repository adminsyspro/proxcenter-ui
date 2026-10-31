/**
 * The caller's inventory, as every catalog tool sees it.
 *
 * The assistant used to read `prisma.connection.findMany({ type: 'pve' })` and
 * hit `/cluster/resources` directly. That is tenant-scoped (session Prisma) but
 * it bypasses RBAC entirely: a user restricted to a pool, a tag or a set of
 * nodes still got the whole tenant's guests in the prompt, and could simply
 * ask the assistant to list them. The snapshot below goes through the same
 * pipeline `/api/v1/inventory` uses (vDC mask, then RBAC infra scope, then
 * per-guest `filterVmsByPermission`), so a tool can never see more than the
 * caller's own inventory tree, whether the caller is a session or an API token.
 *
 * Reading the shared inventory cache instead of re-sweeping Proxmox also makes
 * the tools cheap: they answer from an already-warm snapshot rather than
 * fanning out to `pveproxy` per question.
 */

import { getCurrentTenantId } from '@/lib/tenant'
import {
  getRBACContext,
  getRbacInfraScope,
  filterVmsByPermission,
  applyRbacInfraFilter,
  filterCandidateConnections,
  pruneEmptyConnections,
  PERMISSIONS,
} from '@/lib/rbac'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { getVdcContext } from '@/lib/vdc/context'
import { applyVdcFilter } from '@/lib/vdc/scope'
import { getInventorySWR, type ClusterData } from '@/lib/inventory/fetchRawInventory'

const BYTES_PER_GB = 1024 * 1024 * 1024

export type SnapshotGuest = {
  connId: string
  cluster: string
  vmid: string
  name: string
  /** `VM` for qemu, `CT` for lxc, the wording the prompt and answers use. */
  type: 'VM' | 'CT'
  /** Raw Proxmox kind, kept for tools that must build an API path. */
  kind: 'qemu' | 'lxc'
  status: string
  node: string
  cpuPct: number
  /** vCPUs assigned, absent when Proxmox did not report it. */
  vcpus?: number
  memPct: number
  memUsedGb: number
  memTotalGb: number
  /** Provisioned disk, from `maxdisk`. */
  diskTotalGb?: number
  /** Disk in use as Proxmox sees it; meaningless for most qemu guests. */
  diskUsedGb?: number
  pool?: string
  tags?: string
  template: boolean
  uptimeSeconds?: number
  /** Proxmox HA state (`started`, `stopped`, `error`...), absent when HA does not manage the guest. */
  haState?: string
  haGroup?: string
}

export type SnapshotNode = {
  connId: string
  cluster: string
  name: string
  status: string
  cpuPct: number
  cores?: number
  memPct: number
  memUsedGb: number
  memTotalGb: number
  maintenance?: string
  uptimeSeconds?: number
  pveVersion?: string
  kernel?: string
  /** 1-minute load average. */
  load1?: number
  iowaitPct?: number
  swapUsedGb?: number
  swapTotalGb?: number
  rootfsPct?: number
}

export type SnapshotCluster = {
  id: string
  name: string
  nodeCount: number
  guestCount: number
  cephHealth?: string
}

export type InventorySnapshot = {
  clusters: SnapshotCluster[]
  nodes: SnapshotNode[]
  guests: SnapshotGuest[]
  summary: {
    totalGuests: number
    runningGuests: number
    stoppedGuests: number
    totalNodes: number
    onlineNodes: number
  }
  /** Whether the snapshot came from cache, for logging only. */
  cached: boolean
  /**
   * True when a vDC mask or a non-admin RBAC scope trimmed the inventory.
   * Data the snapshot cannot place on one of its hosts, guests or clusters
   * (a PBS server alert) is then withheld rather than shown. Absent counts
   * as restricted.
   */
  restricted?: boolean
}

function pct(used?: number, total?: number): number {
  if (!used || !total || total <= 0) return 0

  return Number(((used / total) * 100).toFixed(1))
}

function gb(bytes?: number, digits = 1): number {
  if (!bytes || bytes <= 0) return 0

  return Number((bytes / BYTES_PER_GB).toFixed(digits))
}

/**
 * The caller's inventory tree, filtered exactly like `/api/v1/inventory`.
 *
 * Mirrors that route step for step on purpose: the two must not be allowed to
 * disagree about what a scoped user may see.
 */
export async function collectInventorySnapshot(): Promise<InventorySnapshot> {
  const tenantId = await getCurrentTenantId()

  // Resolve the principal before the scope: an API token must never depend on
  // a browser view-context cookie (shared cookie jar).
  const rbacCtx = await getRBACContext()
  const isTokenPrincipal = rbacCtx?.principal?.kind === 'token'
  const vdcContext = isTokenPrincipal ? null : await getVdcContext(tenantId)
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: isTokenPrincipal })
  const mask = maskingScope(infra)

  const { raw, cached } = await getInventorySWR(tenantId, infra, false, false, vdcContext)

  const rbacPrincipal = rbacCtx?.principal ?? (rbacCtx?.userId as string | undefined)
  const rbacScope = rbacCtx && !rbacCtx.isAdmin && rbacPrincipal
    ? await getRbacInfraScope(rbacPrincipal, rbacCtx.tenantId)
    : null

  let visibleRaw = mask ? raw.clusters.filter(c => mask.connectionIds.has(c.id)) : raw.clusters

  // Candidate set only: a guest-derived (tag/pool) scope cannot decide here,
  // the surviving guests below define the real perimeter (#633).
  visibleRaw = filterCandidateConnections(visibleRaw, rbacScope)

  let clusters: ClusterData[] = visibleRaw.map(c => ({
    ...c,
    nodes: c.nodes.map(n => ({ ...n, guests: [...n.guests] })),
  }))

  clusters = await Promise.all(clusters.map(async cluster => {
    let filtered = cluster

    if (rbacCtx && !rbacCtx.isAdmin) {
      const filteredNodes = await Promise.all(
        cluster.nodes.map(async node => ({
          ...node,
          guests: await filterVmsByPermission(
            rbacPrincipal as any,
            node.guests.map(g => ({
              ...g,
              connId: cluster.id,
              node: node.node,
              vmid: String(g.vmid),
            })),
            PERMISSIONS.VM_VIEW,
            rbacCtx.tenantId
          ),
        }))
      )

      filtered = { ...cluster, nodes: filteredNodes }
    }

    return applyRbacInfraFilter(applyVdcFilter(filtered, mask), rbacScope)
  }))

  clusters = pruneEmptyConnections(clusters, rbacScope)

  const aiClusters: SnapshotCluster[] = []
  const nodes: SnapshotNode[] = []
  const guests: SnapshotGuest[] = []

  for (const cluster of clusters) {
    let guestCount = 0

    for (const node of cluster.nodes) {
      nodes.push({
        connId: cluster.id,
        cluster: cluster.name,
        name: node.node,
        status: node.status,
        cpuPct: node.cpu ? Number((node.cpu * 100).toFixed(1)) : 0,
        cores: node.maxcpu,
        memPct: pct(node.mem, node.maxmem),
        memUsedGb: gb(node.mem),
        memTotalGb: gb(node.maxmem),
        maintenance: node.maintenance,
        // Already in the per-node status call the inventory makes: free.
        uptimeSeconds: node.uptime || undefined,
        pveVersion: node.pveVersion || undefined,
        kernel: node.kernel || undefined,
        load1: Array.isArray(node.loadavg) && Number.isFinite(Number(node.loadavg[0])) ? Number(node.loadavg[0]) : undefined,
        iowaitPct: typeof node.iowait === 'number' ? Number((node.iowait * 100).toFixed(1)) : undefined,
        swapUsedGb: node.swapTotal ? gb(node.swapUsed) : undefined,
        swapTotalGb: node.swapTotal ? gb(node.swapTotal) : undefined,
        rootfsPct: node.rootfsTotal ? pct(node.rootfsUsed, node.rootfsTotal) : undefined,
      })

      for (const g of node.guests) {
        guestCount++
        guests.push({
          connId: cluster.id,
          cluster: cluster.name,
          vmid: String(g.vmid),
          name: g.name || `${g.type}/${g.vmid}`,
          type: g.type === 'lxc' ? 'CT' : 'VM',
          kind: g.type === 'lxc' ? 'lxc' : 'qemu',
          status: g.status,
          node: node.node,
          cpuPct: g.cpu ? Number((g.cpu * 100).toFixed(1)) : 0,
          vcpus: g.maxcpu,
          memPct: pct(g.mem, g.maxmem),
          memUsedGb: gb(g.mem, 2),
          memTotalGb: gb(g.maxmem, 2),
          diskTotalGb: g.maxdisk ? gb(g.maxdisk) : undefined,
          diskUsedGb: g.disk ? gb(g.disk) : undefined,
          pool: g.pool,
          tags: g.tags,
          template: g.template === true,
          uptimeSeconds: g.uptime || undefined,
          haState: g.hastate || undefined,
          haGroup: g.hagroup || undefined,
        })
      }
    }

    aiClusters.push({
      id: cluster.id,
      name: cluster.name,
      nodeCount: cluster.nodes.length,
      guestCount,
      cephHealth: cluster.cephHealth,
    })
  }

  const runningGuests = guests.filter(g => g.status === 'running').length
  const onlineNodes = nodes.filter(n => n.status === 'online').length

  return {
    clusters: aiClusters,
    nodes,
    guests,
    summary: {
      totalGuests: guests.length,
      runningGuests,
      stoppedGuests: guests.length - runningGuests,
      totalNodes: nodes.length,
      onlineNodes,
    },
    cached,
    restricted: Boolean(mask) || !rbacCtx || !rbacCtx.isAdmin,
  }
}
