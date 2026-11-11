// Move a guest from one vDC of a tenant to another of its vDCs on another
// cluster (#1335). This module answers the dialog (what moves, where it can
// go, what blocks it) and starts the copy; runner.ts watches it and links the
// guest to the target vDC once it landed.
//
// Every value a blocker carries is inside the tenant's own perimeter: its
// guest's disks and NICs, its target vDC's storages and networks, numbers.
// Never a node, an address, another guest or another tenant of the target
// cluster (a tenant error must not name what it cannot see).

import { nanoid } from 'nanoid'

import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { captureReplicationJobs, findSiteRecoveryJobsForGuest } from '@/lib/migration/ccm-prereqs'
import { buildRemoteMigrateEndpoint } from '@/lib/migration/remoteMigrateEndpoint'
import { resolveInstanceId } from '@/lib/migration/orphan-sweep'
import { PVE_DEFAULT_CPU_MODEL, validateCpuAgainstPolicy } from '@/lib/vdc/computePolicy'
import { checkVdcQuota, getVdcStorageUsedMb } from '@/lib/vdc/quota'
import {
  diskStoragesOf,
  findVdcByPool,
  loadPveConnection,
  loadTenantVdcs,
  quotaPoliciesOf,
  type MoveVdc,
} from './context'
import {
  buildPveMapping,
  inspectGuestConfig,
  pickTargetNode,
  sameGuestShape,
  targetRunsMachine,
  validateMoveMapping,
  type InspectedGuest,
  type MoveIssue,
  type MoveMapping,
} from './plan'
import { bwlimitKiBps, loadVdcMoveSettings, type VdcMoveSettings } from './settings'

export const ACTIVE_MOVE_STATUSES = ['queued', 'copying', 'finalizing'] as const

export type MoveBlockerCode =
  | MoveIssue['code']
  | 'LXC_NOT_SUPPORTED'
  | 'NOT_IN_VDC'
  | 'NO_OTHER_VDC'
  | 'TARGET_VDC_UNKNOWN'
  | 'GUEST_LOCKED'
  | 'SNAPSHOTS_PRESENT'
  | 'HA_MANAGED'
  | 'REPLICATION_CONFIGURED'
  | 'SITE_RECOVERY_JOB'
  | 'MOVE_IN_PROGRESS'
  | 'TOO_MANY_MOVES'
  | 'SELF_SERVICE_DISABLED'
  | 'CPU_MODEL_NOT_ALLOWED'
  | 'VMID_TAKEN_ON_TARGET'
  | 'NO_TARGET_NODE'
  | 'QUOTA_EXCEEDED'
  | 'TARGET_QEMU_TOO_OLD'

export interface MoveBlocker {
  code: MoveBlockerCode
  context?: Record<string, string | number>
  /** Quota violations, phrased on the target vDC's own figures. */
  details?: string[]
}

export class MoveRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export interface MoveActor {
  /** Tenant of the session; 'default' for the provider. */
  tenantId: string
  isProvider: boolean
  userEmail?: string | null
}

export interface MoveSource {
  conn: any
  connectionId: string
  node: string
  vmid: number
  name: string
  running: boolean
  vdc: MoveVdc
  config: Record<string, unknown>
  inspected: InspectedGuest
}

/**
 * The guest and the vDC it belongs to. A tenant only reaches its own guests:
 * anything else answers "not found", never "forbidden", so a probe learns
 * nothing about the provider's other pools.
 */
export async function resolveMoveSource(actor: MoveActor, connectionId: string, node: string, vmid: number): Promise<MoveSource> {
  const conn = await loadPveConnection(connectionId)
  const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
  const entry = (Array.isArray(resources) ? resources : []).find((r: any) => Number(r?.vmid) === vmid)
  if (!entry || entry.node !== node) throw new MoveRequestError(404, 'GUEST_NOT_FOUND', 'Guest not found')
  if (entry.type !== 'qemu') throw new MoveRequestError(400, 'LXC_NOT_SUPPORTED', 'Only virtual machines can be moved to another vDC')

  const vdc = entry.pool ? await findVdcByPool(connectionId, String(entry.pool)) : null
  if (!vdc) {
    if (!actor.isProvider) throw new MoveRequestError(404, 'GUEST_NOT_FOUND', 'Guest not found')
    throw new MoveRequestError(400, 'NOT_IN_VDC', 'This VM does not belong to a vDC')
  }
  if (!actor.isProvider && vdc.tenantId !== actor.tenantId) throw new MoveRequestError(404, 'GUEST_NOT_FOUND', 'Guest not found')

  const base = `/nodes/${encodeURIComponent(node)}/qemu/${vmid}`
  // /cluster/resources lags a few seconds behind a start: the guest's own
  // status decides whether an offline move has to stop it first.
  const [config, current] = await Promise.all([
    pveFetch<Record<string, unknown>>(conn, `${base}/config`),
    pveFetch<{ status?: string }>(conn, `${base}/status/current`).catch(() => null),
  ])

  return {
    conn,
    connectionId,
    node,
    vmid,
    name: String(entry.name ?? config?.name ?? ''),
    running: (current?.status ?? entry.status) === 'running',
    vdc,
    config: config ?? {},
    inspected: inspectGuestConfig(config ?? {}),
  }
}

/** What forbids moving this guest whatever the target: tenant-safe codes only. */
export async function sourceBlockers(source: MoveSource, actor: MoveActor, settings: VdcMoveSettings): Promise<MoveBlocker[]> {
  const blockers: MoveBlocker[] = source.inspected.blockers.map((b) => ({ code: b.code, context: b.context }))
  const base = `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}`

  if (!actor.isProvider && !settings.tenantSelfService) blockers.push({ code: 'SELF_SERVICE_DISABLED' })
  if (source.config.lock) blockers.push({ code: 'GUEST_LOCKED', context: { lock: String(source.config.lock) } })

  const [snapshots, ha, replication, siteRecovery, activeForGuest, activeForTenant] = await Promise.all([
    pveFetch<any[]>(source.conn, `${base}/snapshot`).catch(() => []),
    pveFetch<any[]>(source.conn, '/cluster/ha/resources').catch(() => []),
    captureReplicationJobs(source.conn, source.vmid).catch(() => []),
    findSiteRecoveryJobsForGuest(source.connectionId, source.vmid).catch(() => []),
    prisma.vdcMove.count({ where: { sourceConnectionId: source.connectionId, vmid: source.vmid, status: { in: [...ACTIVE_MOVE_STATUSES] } } }),
    prisma.vdcMove.count({ where: { tenantId: source.vdc.tenantId, status: { in: [...ACTIVE_MOVE_STATUSES] } } }),
  ])

  const snapCount = (Array.isArray(snapshots) ? snapshots : []).filter((s: any) => s?.name !== 'current').length
  if (snapCount > 0) blockers.push({ code: 'SNAPSHOTS_PRESENT', context: { count: snapCount } })
  if ((Array.isArray(ha) ? ha : []).some((r: any) => r?.sid === `vm:${source.vmid}`)) blockers.push({ code: 'HA_MANAGED' })
  if (replication.length > 0) blockers.push({ code: 'REPLICATION_CONFIGURED', context: { count: replication.length } })
  if (siteRecovery.length > 0) blockers.push({ code: 'SITE_RECOVERY_JOB' })
  if (activeForGuest > 0) blockers.push({ code: 'MOVE_IN_PROGRESS' })
  else if (!actor.isProvider && activeForTenant >= settings.maxConcurrentPerTenant) {
    blockers.push({ code: 'TOO_MANY_MOVES', context: { max: settings.maxConcurrentPerTenant } })
  }

  return blockers
}

export interface MoveTargetStorage {
  storage: string
  primary: boolean
  policy: { name: string; iopsRd: number | null; iopsWr: number | null; mbpsRd: number | null; mbpsWr: number | null } | null
  quotaMb: number | null
  usedMb: number | null
}

export interface MoveTargetOption {
  vdcId: string
  name: string
  storages: MoveTargetStorage[]
  networks: Array<{ bridge: string; label: string; kind: 'vnet' | 'shared'; stretched: boolean }>
  defaults: MoveMapping
}

/**
 * Pre-fill: a source storage goes to the target tier of the same policy
 * name, else to the target primary storage; a source network goes to the
 * same stretched tenant network on the target, else to a network of the
 * same name, else stays unset for the user to choose.
 */
export function defaultMapping(source: MoveSource, target: MoveVdc): MoveMapping {
  const storageMap: Record<string, string> = {}
  const targetStorages = diskStoragesOf(target)
  for (const group of source.inspected.storages) {
    const sourcePolicy = source.vdc.policies.find((p) => p.storageId === group.storage)
    const sameName = sourcePolicy ? target.policies.find((p) => p.name.toLowerCase() === sourcePolicy.name.toLowerCase()) : undefined
    const fallback = target.primaryStorage ?? [...targetStorages][0]
    const dest = sameName?.storageId ?? fallback
    if (dest) storageMap[group.storage] = dest
  }

  const bridgeMap: Record<string, string> = {}
  for (const group of source.inspected.bridges) {
    const sourceNet = source.vdc.networks.find((n) => n.bridge === group.bridge)
    const stretched = sourceNet?.tenantNetworkId ? target.networks.find((n) => n.tenantNetworkId === sourceNet.tenantNetworkId) : undefined
    const sameName = target.networks.find((n) => n.bridge === group.bridge)
    const dest = stretched?.bridge ?? sameName?.bridge
    if (dest) bridgeMap[group.bridge] = dest
  }

  return { storageMap, bridgeMap }
}

/** Storages and networks of a target vDC, with the tier usage the dialog shows (one pool read + one listing per metered tier). */
export async function describeTarget(source: MoveSource, target: MoveVdc): Promise<MoveTargetOption> {
  const storages: MoveTargetStorage[] = [...diskStoragesOf(target)].sort((a, b) => a.localeCompare(b)).map((storage) => {
    const policy = target.policies.find((p) => p.storageId === storage)

    return {
      storage,
      primary: storage === target.primaryStorage,
      policy: policy ? { name: policy.name, ...policy.caps } : null,
      quotaMb: policy?.quotaMb ?? null,
      usedMb: null,
    }
  })

  const metered = storages.filter((s) => s.quotaMb !== null)
  if (metered.length > 0) {
    try {
      const conn = await loadPveConnection(target.connectionId)
      const pool = await pveFetch<{ members?: any[] }>(conn, `/pools/${encodeURIComponent(target.poolName)}`).catch(() => ({ members: [] }))
      const members = (pool?.members ?? []).filter((m: any) => m?.type === 'qemu' || m?.type === 'lxc')
      const vmids = new Set<number>(members.map((m: any) => Number(m.vmid)))
      const node = [...target.nodes][0] ?? members[0]?.node
      if (vmids.size === 0) {
        for (const s of metered) s.usedMb = 0
      } else if (node) {
        for (const s of metered) s.usedMb = await getVdcStorageUsedMb(conn, node, s.storage, vmids)
      }
    } catch {
      // Usage is informative here; the quota itself is enforced at launch.
    }
  }

  return {
    vdcId: target.id,
    name: target.name,
    storages,
    networks: target.networks.map((n) => ({ bridge: n.bridge, label: n.label, kind: n.kind, stretched: !!n.tenantNetworkId })),
    defaults: defaultMapping(source, target),
  }
}

export interface MoveOptions {
  guest: {
    vmid: number
    name: string
    running: boolean
    vcpus: number
    memoryMb: number
    totalDiskMb: number
    storages: InspectedGuest['storages']
    bridges: InspectedGuest['bridges']
  }
  sourceVdc: { id: string; name: string }
  targets: Array<{ vdcId: string; name: string }>
  target: MoveTargetOption | null
  blockers: MoveBlocker[]
}

export async function getMoveOptions(actor: MoveActor, connectionId: string, node: string, vmid: number, targetVdcId?: string | null): Promise<MoveOptions> {
  const source = await resolveMoveSource(actor, connectionId, node, vmid)
  const settings = await loadVdcMoveSettings()
  const tenantVdcs = await loadTenantVdcs(source.vdc.tenantId)
  const targets = tenantVdcs.filter((v) => v.connectionId !== source.connectionId)

  const blockers = await sourceBlockers(source, actor, settings)
  if (targets.length === 0) blockers.push({ code: 'NO_OTHER_VDC' })

  const chosen = targetVdcId ? targets.find((t) => t.id === targetVdcId) : targets[0]
  if (targetVdcId && !chosen) throw new MoveRequestError(404, 'TARGET_VDC_UNKNOWN', 'Target vDC not found')

  return {
    guest: {
      vmid,
      name: source.name,
      running: source.running,
      vcpus: source.inspected.vcpus,
      memoryMb: source.inspected.memoryMb,
      totalDiskMb: source.inspected.totalDiskMb,
      storages: source.inspected.storages,
      bridges: source.inspected.bridges,
    },
    sourceVdc: { id: source.vdc.id, name: source.vdc.name },
    targets: targets.map((t) => ({ vdcId: t.id, name: t.name })),
    target: chosen ? await describeTarget(source, chosen) : null,
    blockers,
  }
}

export interface MoveRequest {
  targetVdcId: string
  storageMap: Record<string, string>
  bridgeMap: Record<string, string>
  /** Live copy when the guest runs; false copies it stopped (the caller confirmed the downtime). */
  online: boolean
}

export interface MovePlan {
  source: MoveSource
  target: MoveVdc
  targetNode: string
  targetVmid: number
  mapping: MoveMapping
  online: boolean
  settings: VdcMoveSettings
}

/** Target-side checks: mapping inside the vDC, compute policy, VMID, a node with room, quotas. */
async function targetBlockers(source: MoveSource, target: MoveVdc, mapping: MoveMapping, online: boolean): Promise<{ blockers: MoveBlocker[]; targetNode: string | null }> {
  const blockers: MoveBlocker[] = []
  const vnetBridges = new Set(target.networks.filter((n) => n.kind === 'vnet').map((n) => n.bridge))
  for (const issue of validateMoveMapping(source.inspected, mapping, {
    allowedStorages: diskStoragesOf(target),
    allowedBridges: new Set(target.networks.map((n) => n.bridge)),
    vnetBridges,
    vlanRanges: target.vlanRanges,
  })) blockers.push({ code: issue.code, context: issue.context })
  // A storage or network outside the vDC is the user's choice to fix first:
  // node, VMID and quota answers would only describe a move that cannot happen.
  if (blockers.length > 0) return { blockers, targetNode: null }

  const conn = await loadPveConnection(target.connectionId)
  const resources = await pveFetch<any[]>(conn, '/cluster/resources').catch(() => [])
  const list = Array.isArray(resources) ? resources : []

  if (list.some((r: any) => (r?.type === 'qemu' || r?.type === 'lxc') && Number(r?.vmid) === source.vmid)) {
    blockers.push({ code: 'VMID_TAKEN_ON_TARGET', context: { vmid: source.vmid } })
  }

  // Only nodes where every chosen target storage is active can receive the disks.
  const wanted = new Set(Object.values(mapping.storageMap))
  const nodes = list.filter((r: any) => r?.type === 'node').filter((n: any) =>
    [...wanted].every((storage) => list.some((s: any) => s?.type === 'storage' && s?.node === n.node && s?.storage === storage && s?.status === 'available')))
  const targetNode = pickTargetNode(nodes, target.nodes, source.inspected.memoryMb)
  if (!targetNode) blockers.push({ code: 'NO_TARGET_NODE' })

  // Live only: the guest restarts on the target with the machine it runs now.
  if (online && source.running && targetNode) {
    const [status, machines] = await Promise.all([
      pveFetch<any>(source.conn, `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}/status/current`).catch(() => null),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(targetNode)}/capabilities/qemu/machines`).catch(() => null),
    ])
    if (!targetRunsMachine(status?.['running-machine'], machines)) blockers.push({ code: 'TARGET_QEMU_TOO_OLD' })
  }

  let capabilities: unknown
  if (target.computePolicy.cpuModelMode === 'custom' && targetNode) {
    capabilities = await pveFetch<unknown>(conn, `/nodes/${encodeURIComponent(targetNode)}/capabilities/qemu/cpu`).catch(() => undefined)
  }
  const cpu = typeof source.config.cpu === 'string' && source.config.cpu ? source.config.cpu : PVE_DEFAULT_CPU_MODEL
  const verdict = validateCpuAgainstPolicy(target.computePolicy, { cpu }, { clusterCapabilities: capabilities, currentModel: null })
  if (!verdict.ok) blockers.push({ code: 'CPU_MODEL_NOT_ALLOWED', context: { model: source.inspected.cpuModel ?? PVE_DEFAULT_CPU_MODEL } })

  if (targetNode) {
    const byStorage: Record<string, number> = {}
    for (const group of source.inspected.storages) {
      const dest = mapping.storageMap[group.storage]
      if (dest) byStorage[dest] = (byStorage[dest] ?? 0) + group.sizeMb
    }
    const quota = await checkVdcQuota(target.connectionId, target.poolName, target.quota, {
      type: 'create',
      addVcpus: source.inspected.vcpus,
      addRamMb: source.inspected.memoryMb,
      addStorageMb: source.inspected.totalDiskMb,
      addVms: 1,
      addStorageMbByStorage: byStorage,
    }, quotaPoliciesOf(target), targetNode)
    if (!quota.allowed) blockers.push({ code: 'QUOTA_EXCEEDED', details: quota.violations })
  }

  return { blockers, targetNode }
}

/** Every check of a move, source and target. A plan comes back only when nothing blocks. */
export async function planMove(actor: MoveActor, connectionId: string, node: string, vmid: number, request: MoveRequest): Promise<{ blockers: MoveBlocker[]; plan: MovePlan | null }> {
  const source = await resolveMoveSource(actor, connectionId, node, vmid)
  const settings = await loadVdcMoveSettings()
  const tenantVdcs = await loadTenantVdcs(source.vdc.tenantId)
  const target = tenantVdcs.find((v) => v.id === request.targetVdcId && v.connectionId !== source.connectionId)
  if (!target) throw new MoveRequestError(404, 'TARGET_VDC_UNKNOWN', 'Target vDC not found')

  // Only the source storages and bridges the guest actually uses reach PVE.
  const mapping: MoveMapping = {
    storageMap: Object.fromEntries(source.inspected.storages.filter((g) => request.storageMap[g.storage]).map((g) => [g.storage, request.storageMap[g.storage]])),
    bridgeMap: Object.fromEntries(source.inspected.bridges.filter((g) => request.bridgeMap[g.bridge]).map((g) => [g.bridge, request.bridgeMap[g.bridge]])),
  }

  const [fromSource, fromTarget] = await Promise.all([
    sourceBlockers(source, actor, settings),
    targetBlockers(source, target, mapping, request.online),
  ])
  const blockers = [...fromSource, ...fromTarget.blockers]
  if (blockers.length > 0 || !fromTarget.targetNode) return { blockers, plan: null }

  return {
    blockers: [],
    plan: { source, target, targetNode: fromTarget.targetNode, targetVmid: vmid, mapping, online: request.online && source.running, settings },
  }
}

const STOP_TIMEOUT_S = 120
// No colon or parenthesis: tenants read it whole (see tenantSafeError).
const GUEST_CHANGED_MESSAGE = 'The VM configuration changed after the checks. The VM was not moved, start the move again'
const STOP_POLL_MS = 3_000

async function heartbeat(moveId: string): Promise<void> {
  await prisma.vdcMove.updateMany({ where: { id: moveId, holder: resolveInstanceId() }, data: { heartbeatAt: new Date() } })
}

/**
 * Shut the guest down (forced stop after STOP_TIMEOUT_S) and wait for it:
 * PVE copies a running guest only live, so an offline move of a running
 * guest stops it first. The move's heartbeat is renewed while waiting.
 */
async function stopGuest(source: MoveSource, moveId: string): Promise<void> {
  const base = `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}`
  const upid = await pveFetch<string>(source.conn, `${base}/status/shutdown`, {
    method: 'POST',
    body: new URLSearchParams({ forceStop: '1', timeout: String(STOP_TIMEOUT_S) }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const deadline = Date.now() + (STOP_TIMEOUT_S + 60) * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS))
    await heartbeat(moveId).catch(() => {})
    const task = typeof upid === 'string'
      ? await pveFetch<any>(source.conn, `/nodes/${encodeURIComponent(source.node)}/tasks/${encodeURIComponent(upid)}/status`).catch(() => null)
      : null
    if (!task || task.status === 'stopped') break
  }
  const status = await pveFetch<any>(source.conn, `${base}/status/current`).catch(() => null)
  if (status?.status !== 'stopped') throw new Error('The VM did not stop')
}

/** Ask the source cluster to copy the guest, the move row already exists. */
async function launchCopy(moveId: string, plan: MovePlan, actor: MoveActor, stopFirst: boolean): Promise<string> {
  const { source, target } = plan
  try {
    if (stopFirst) await stopGuest(source, moveId)
    const targetConn = await loadPveConnection(target.connectionId)
    const endpoint = await buildRemoteMigrateEndpoint(targetConn, plan.targetNode)
    if (!endpoint.ok) throw new Error(endpoint.error)

    const params: Record<string, string> = {
      'target-endpoint': endpoint.endpoint,
      'target-storage': buildPveMapping(plan.mapping.storageMap),
      'target-vmid': String(plan.targetVmid),
    }
    if (Object.keys(plan.mapping.bridgeMap).length > 0) params['target-bridge'] = buildPveMapping(plan.mapping.bridgeMap)
    if (plan.online) params.online = '1'
    // A move always leaves its source: PVE removes the source guest itself
    // once the migration completed, with no SSH unlock on the source node
    // (seen in the lab: without it, a source with no SSH access stayed
    // behind, locked, in the tenant's source vDC).
    params.delete = '1'
    const bw = bwlimitKiBps(plan.settings)
    if (bw) params.bwlimit = String(bw)

    // Last read before the copy: a disk, NIC or size changed since the
    // checks (the shutdown above can take minutes) would reach the target
    // unchecked, PVE keeping the same storage or bridge name for anything
    // missing from the mapping.
    const current = await pveFetch<Record<string, unknown>>(source.conn, `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}/config`)
    if (!sameGuestShape(source.inspected, inspectGuestConfig(current ?? {}))) {
      throw new Error(GUEST_CHANGED_MESSAGE)
    }

    const upid = await pveFetch<string>(source.conn, `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}/remote_migrate`, {
      method: 'POST',
      body: new URLSearchParams(params).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) throw new Error('Proxmox did not start the copy')

    await prisma.vdcMove.update({ where: { id: moveId }, data: { status: 'copying', upid, heartbeatAt: new Date() } })

    return upid
  } catch (e: any) {
    // Nothing was copied: the guest stays where it is, in its vDC (stopped
    // when the failure came after the shutdown of an offline move).
    await prisma.vdcMove.update({
      where: { id: moveId },
      data: { status: 'failed', error: String(e?.message || e).slice(0, 500), finishedAt: new Date(), holder: null },
    })
    if (e?.message === GUEST_CHANGED_MESSAGE) throw new MoveRequestError(409, 'GUEST_CHANGED', GUEST_CHANGED_MESSAGE)
    // The raw Proxmox error can name a node or an address of the target
    // cluster: only the provider reads it.
    throw new MoveRequestError(502, 'MOVE_START_FAILED', actor.isProvider
      ? `The copy could not start: ${String(e?.message || e)}`
      : 'The copy could not start. The VM was not moved.')
  }
}

/**
 * Record the move, then ask the source cluster to copy the guest. The row
 * exists before the Proxmox task does, so a crash between the two leaves a
 * `queued` move the reconciler closes rather than a copy nobody follows.
 *
 * An offline move of a running guest shuts it down first, which can take
 * longer than a request may last: that copy starts in the background, and
 * `upid` comes back null with `stopping` set.
 */
export async function startMove(
  plan: MovePlan,
  actor: MoveActor,
  origin: 'tenant' | 'provider' = 'tenant',
  onCopying?: (moveId: string) => void,
): Promise<{ moveId: string; upid: string | null; stopping: boolean }> {
  const { source, target } = plan
  const moveId = nanoid()

  await prisma.vdcMove.create({
    data: {
      id: moveId,
      tenantId: source.vdc.tenantId,
      guestName: source.name || null,
      vmid: source.vmid,
      targetVmid: plan.targetVmid,
      sourceConnectionId: source.connectionId,
      sourceNode: source.node,
      sourceVdcId: source.vdc.id,
      targetConnectionId: target.connectionId,
      targetNode: plan.targetNode,
      targetVdcId: target.id,
      storageMap: plan.mapping.storageMap,
      bridgeMap: plan.mapping.bridgeMap,
      online: plan.online,
      deleteSource: true,
      origin,
      status: 'queued',
      requestedBy: actor.userEmail ?? null,
      holder: resolveInstanceId(),
      heartbeatAt: new Date(),
    },
  })

  const stopFirst = source.running && !plan.online
  if (stopFirst) {
    void launchCopy(moveId, plan, actor, true)
      .then(() => onCopying?.(moveId))
      .catch(() => { /* recorded on the move */ })

    return { moveId, upid: null, stopping: true }
  }

  const upid = await launchCopy(moveId, plan, actor, false)
  onCopying?.(moveId)

  return { moveId, upid, stopping: false }
}

/**
 * The provider's own cross-cluster migration of a guest that sits in a vDC:
 * when the tenant has a vDC on the target cluster, record the migration as a
 * move so the guest joins that vDC (pool, policy caps, IPAM) once it landed,
 * instead of arriving outside any vDC. The provider chose one target storage
 * and one bridge: every source storage and bridge maps onto them. Returns
 * null when the guest is in no vDC or the tenant has none on the target.
 */
export async function recordProviderMigrationAsMove(input: {
  sourceConnectionId: string
  sourceNode: string
  vmid: number
  targetConnectionId: string
  targetNode: string
  targetVmid: number
  targetStorage: string
  targetBridge: string
  online: boolean
  deleteSource: boolean
  upid: string
  requestedBy?: string | null
}): Promise<{ moveId: string; targetVdcName: string } | null> {
  const conn = await loadPveConnection(input.sourceConnectionId)
  const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm').catch(() => [])
  const entry = (Array.isArray(resources) ? resources : []).find((r: any) => Number(r?.vmid) === input.vmid)
  if (!entry?.pool) return null
  const sourceVdc = await findVdcByPool(input.sourceConnectionId, String(entry.pool))
  if (!sourceVdc) return null
  const target = (await loadTenantVdcs(sourceVdc.tenantId)).find((v) => v.connectionId === input.targetConnectionId)
  if (!target) return null

  const config = await pveFetch<Record<string, unknown>>(conn, `/nodes/${encodeURIComponent(input.sourceNode)}/qemu/${input.vmid}/config`).catch(() => ({}))
  const inspected = inspectGuestConfig(config ?? {})
  const moveId = nanoid()
  await prisma.vdcMove.create({
    data: {
      id: moveId,
      tenantId: sourceVdc.tenantId,
      guestName: entry.name ? String(entry.name) : null,
      vmid: input.vmid,
      targetVmid: input.targetVmid,
      sourceConnectionId: input.sourceConnectionId,
      sourceNode: input.sourceNode,
      sourceVdcId: sourceVdc.id,
      targetConnectionId: input.targetConnectionId,
      targetNode: input.targetNode,
      targetVdcId: target.id,
      storageMap: Object.fromEntries(inspected.storages.map((g) => [g.storage, input.targetStorage])),
      bridgeMap: Object.fromEntries(inspected.bridges.map((g) => [g.bridge, input.targetBridge])),
      online: input.online,
      deleteSource: input.deleteSource,
      origin: 'provider',
      status: 'copying',
      upid: input.upid,
      requestedBy: input.requestedBy ?? null,
      holder: resolveInstanceId(),
      heartbeatAt: new Date(),
    },
  })

  return { moveId, targetVdcName: target.name }
}
