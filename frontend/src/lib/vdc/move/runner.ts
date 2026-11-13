// Follow a move between vDCs (#1335) to its end, durably.
//
// The process that started the copy watches the Proxmox task and renews the
// move's heartbeat. Once the guest landed, finalizeMove() links it to the
// target vDC: PVE pool, storage-policy caps, IPAM, caches, audit. Every step
// is idempotent, so the reconciler of any replica can take over a move whose
// heartbeat went stale (process restarted, replica lost) and run the same
// code again from wherever it stopped.

import { prisma } from '@/lib/db/prisma'
import { audit } from '@/lib/audit'
import { pveFetch } from '@/lib/proxmox/client'
import { refreshCachedGuests } from '@/lib/cache/guestSetRefresh'
import { forgetCachedGuest } from '@/lib/cache/inventoryCache'
import { watchMigrationAndCleanup } from '@/lib/migration/cross-cluster-watcher'
import { resolveInstanceId } from '@/lib/migration/orphan-sweep'
import { tryAcquireLease, releaseLease } from '@/lib/scheduler/lease'
import { runWithBackgroundTenant } from '@/lib/tenant/background'
import { parseDriveString } from '@/lib/vdc/drives'
import { connectionOwnerTenant, loadPveConnection, loadVdcById, policyCapsFor, type MoveVdc } from './context'
import { restampDriveForTarget } from './plan'

export const MOVE_POLL_INTERVAL_MS = 5_000
const HEARTBEAT_EVERY_MS = 30_000
/** A heartbeat older than this hands the move to the reconciler. */
export const MOVE_STALE_AFTER_MS = 2 * 60_000
const RECONCILE_INTERVAL_MS = 60_000
const LEASE_NAME = 'vdc-moves'
const LEASE_TTL_MS = 3 * 60_000

export type MoveWarning = { code: 'SOURCE_LEFT' | 'SOURCE_POOL_ENTRY_LEFT' | 'ADDRESS_RELEASED' | 'POOL_LINK_FAILED' | 'CAPS_NOT_APPLIED'; context?: Record<string, string | number> }

type MoveRow = Awaited<ReturnType<typeof prisma.vdcMove.findUnique>> & {}

/** In-process moves this replica is following, so a second claim of the same row is a no-op. */
const following = new Set<string>()

async function heartbeat(moveId: string, holder: string): Promise<void> {
  await prisma.vdcMove.updateMany({ where: { id: moveId, holder }, data: { heartbeatAt: new Date() } })
}

/** Heartbeat of a move this replica holds (the provider's cross-cluster migration follows its own task). */
export async function heartbeatMove(moveId: string): Promise<void> {
  await heartbeat(moveId, resolveInstanceId())
}

export async function failMove(moveId: string, error: string): Promise<void> {
  await fail(moveId, error)
}

async function fail(moveId: string, error: string): Promise<void> {
  await prisma.vdcMove.update({ where: { id: moveId }, data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date(), holder: null } })
}

/** Disk keys of a config line set whose volume sits on `storage`. */
function diskKeysOn(config: Record<string, unknown>, storages: Set<string>): string[] {
  return Object.entries(config)
    .filter(([key]) => /^(scsi|virtio|ide|sata)\d+$/.test(key))
    .filter(([, value]) => {
      const parsed = parseDriveString(String(value ?? ''))
      return parsed.ok === true && !parsed.drive.isCdrom && !!parsed.drive.storage && storages.has(parsed.drive.storage)
    })
    .map(([key]) => key)
}

async function poolHas(conn: any, pool: string, vmid: number): Promise<boolean> {
  const data = await pveFetch<{ members?: any[] }>(conn, `/pools/${encodeURIComponent(pool)}`).catch(() => null)

  return (data?.members ?? []).some((m: any) => Number(m?.vmid) === vmid)
}

/**
 * Put the guest in the target vDC's pool. PVE refuses a VMID the pool already
 * lists ("already a pool member"), which happens when a guest of that VMID
 * left this cluster earlier: PVE drops the guest but not its pool entry.
 * Then the guest is in the pool already, which is the goal.
 */
async function linkPool(targetConn: any, move: MoveRow, target: MoveVdc): Promise<void> {
  try {
    await pveFetch(targetConn, `/pools/${encodeURIComponent(target.poolName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ vms: String(move.targetVmid), 'allow-move': '1' }).toString(),
    })
  } catch (e) {
    if (await poolHas(targetConn, target.poolName, move.targetVmid)) return
    throw e
  }
}

/**
 * Drop the VMID from the source vDC's pool once the source guest is gone:
 * PVE keeps the entry after a migration with delete, and a guest created
 * later with the same VMID on that cluster would land in this tenant's vDC.
 * The entry of a guest that no longer exists does not show in the pool's
 * member list (measured in the lab), so the removal is always attempted and
 * "is not a pool member" means there was nothing to remove.
 */
async function unlinkSourcePool(move: MoveRow, source: MoveVdc): Promise<void> {
  const conn = await loadPveConnection(move.sourceConnectionId)
  try {
    await pveFetch(conn, `/pools/${encodeURIComponent(source.poolName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ vms: String(move.vmid), delete: '1' }).toString(),
    })
  } catch (e: any) {
    if (/is not a pool member/.test(String(e?.message || e))) return
    throw e
  }
}

/**
 * Replace the source tier's caps with the target tier's on every moved disk:
 * PVE carries the drive options across the migration, so without this the
 * disk keeps the caps of a tier it no longer sits on.
 */
async function restampCaps(targetConn: any, move: MoveRow, source: MoveVdc | null, target: MoveVdc): Promise<void> {
  const path = `/nodes/${encodeURIComponent(move.targetNode)}/qemu/${move.targetVmid}/config`
  const config = await pveFetch<Record<string, unknown>>(targetConn, path)
  const storageMap = (move.storageMap ?? {}) as Record<string, string>
  const sourceByTarget = new Map<string, string[]>()
  for (const [src, dst] of Object.entries(storageMap)) sourceByTarget.set(dst, [...(sourceByTarget.get(dst) ?? []), src])

  const changes: Record<string, string> = {}
  for (const key of diskKeysOn(config ?? {}, new Set(Object.values(storageMap)))) {
    const raw = String(config[key])
    const parsed = parseDriveString(raw)
    if (parsed.ok === false || !parsed.drive.storage) continue
    const dest = parsed.drive.storage
    const sourceWasPolicied = !!source && (sourceByTarget.get(dest) ?? []).some((src) => !!policyCapsFor(source, src))
    const next = restampDriveForTarget(raw, policyCapsFor(target, dest), sourceWasPolicied)
    if (next !== raw) changes[key] = next
  }
  if (Object.keys(changes).length === 0) return

  await pveFetch(targetConn, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(changes).toString(),
  })
}

/**
 * IPAM: on a stretched tenant network (#901) the address is the same L2
 * domain on both sides, so the reservation follows the guest. On any other
 * network the source reservation is released; the guest keeps whatever its
 * OS configured, and the tenant is told to re-address it.
 */
async function moveAddresses(move: MoveRow, target: MoveVdc): Promise<MoveWarning[]> {
  const warnings: MoveWarning[] = []
  const rows = await prisma.vdcIpamAllocation.findMany({
    where: { connectionId: move.sourceConnectionId, vmid: move.vmid },
    include: { vnet: { select: { pveName: true, tenantNetworkMember: { select: { tenantNetworkId: true } } } } },
  })
  const bridgeMap = (move.bridgeMap ?? {}) as Record<string, string>

  for (const row of rows) {
    const destBridge = bridgeMap[row.vnet.pveName]
    const network = row.vnet.tenantNetworkMember?.tenantNetworkId
    const dest = network ? target.networks.find((n) => n.bridge === destBridge && n.tenantNetworkId === network) : undefined
    if (dest?.vnetId) {
      await prisma.vdcIpamAllocation.update({
        where: { id: row.id },
        data: { vdcId: target.id, vnetId: dest.vnetId, connectionId: move.targetConnectionId, vmid: move.targetVmid },
      })
    } else {
      await prisma.vdcIpamAllocation.delete({ where: { id: row.id } }).catch(() => {})
      warnings.push({ code: 'ADDRESS_RELEASED', context: { ip: row.ip } })
    }
  }

  return warnings
}

/** Link the landed guest to its target vDC. Safe to run twice. */
export async function finalizeMove(moveId: string, sourceLeft = false): Promise<void> {
  const move = await prisma.vdcMove.findUnique({ where: { id: moveId } })
  if (!move || move.status === 'done' || move.status === 'failed') return
  await prisma.vdcMove.update({ where: { id: moveId }, data: { status: 'finalizing', heartbeatAt: new Date() } })

  const target = await loadVdcById(move.targetVdcId)
  if (!target) {
    await fail(moveId, 'The target vDC no longer exists; the VM landed outside any vDC')
    return
  }
  const source = await loadVdcById(move.sourceVdcId)
  const targetConn = await loadPveConnection(move.targetConnectionId)
  const warnings: MoveWarning[] = []
  if (sourceLeft) warnings.push({ code: 'SOURCE_LEFT' })

  try {
    await linkPool(targetConn, move, target)
  } catch (e: any) {
    // Without the pool the tenant cannot see its guest: the move is not done.
    await fail(moveId, `The VM landed on the target cluster but could not join the vDC pool: ${String(e?.message || e)}`)
    return
  }
  try {
    await restampCaps(targetConn, move, source, target)
  } catch (e: any) {
    console.warn(`[vdc-move:${moveId}] storage-policy caps not applied: ${String(e?.message || e).replace(/[\r\n]/g, ' ')}`)
    warnings.push({ code: 'CAPS_NOT_APPLIED' })
  }
  warnings.push(...await moveAddresses(move, target))
  if (source && move.deleteSource && !sourceLeft) {
    await unlinkSourcePool(move, source).catch((e: any) => {
      console.warn(`[vdc-move:${moveId}] source pool entry kept: ${String(e?.message || e).replace(/[\r\n]/g, ' ')}`)
      warnings.push({ code: 'SOURCE_POOL_ENTRY_LEFT' })
    })
  }

  forgetCachedGuest(move.sourceConnectionId, 'qemu', move.vmid)
  await refreshCachedGuests(move.targetConnectionId, targetConn, { type: 'qemu', vmid: move.targetVmid })

  await prisma.vdcMove.update({
    where: { id: moveId },
    data: { status: 'done', warnings: warnings.length > 0 ? warnings : undefined, finishedAt: new Date(), holder: null },
  })

  await audit({
    action: 'migrate',
    category: 'vms',
    resourceType: 'qemu',
    resourceId: String(move.targetVmid),
    resourceName: move.guestName ?? undefined,
    tenantId: move.tenantId,
    userEmail: move.requestedBy ?? undefined,
    details: { kind: 'vdc-move', moveId, fromVdc: source?.name ?? move.sourceVdcId, toVdc: target.name, warnings: warnings.map((w) => w.code) },
  }).catch(() => {})
}

/** Watch the copy of a move this process holds, then finalize it. */
export async function followMove(moveId: string): Promise<void> {
  if (following.has(moveId)) return
  following.add(moveId)
  const holder = resolveInstanceId()
  try {
    const move = await prisma.vdcMove.findUnique({ where: { id: moveId } })
    if (!move) return
    if (move.status === 'finalizing') {
      await finalizeMove(moveId)
      return
    }
    if (move.status !== 'copying' || !move.upid) return

    const sourceConn = await loadPveConnection(move.sourceConnectionId)
    const targetConn = await loadPveConnection(move.targetConnectionId)
    let lastBeat = 0
    const result = await watchMigrationAndCleanup({
      connectionId: move.sourceConnectionId,
      // The SSH unlock fallback reads the source connection's credentials,
      // which belong to its owner (the provider), not to the vDC tenant.
      tenantId: await connectionOwnerTenant(move.sourceConnectionId),
      sourceConn,
      sourceNode: move.sourceNode,
      vmid: String(move.vmid),
      upid: move.upid,
      deleteSource: move.deleteSource,
      guestType: 'qemu',
      targetConn,
      targetNode: move.targetNode,
      targetVmid: String(move.targetVmid),
      pollIntervalMs: MOVE_POLL_INTERVAL_MS,
      onPoll: async () => {
        if (Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return
        lastBeat = Date.now()
        await heartbeat(moveId, holder)
      },
    })

    if (result.outcome === 'completed') await finalizeMove(moveId, move.deleteSource && result.sourceLeft)
    else if (result.outcome === 'failed') await fail(moveId, `The copy failed (${result.exitstatus || 'unknown'}); the VM stays in its source vDC`)
    else if (result.outcome === 'timeout') await fail(moveId, 'The copy did not finish in time; check the migration task on the source cluster')
    else await fail(moveId, 'Invalid move')
  } catch (e: any) {
    console.error(`[vdc-move:${moveId}] follow failed:`, String(e?.message || e).replace(/[\r\n]/g, ' '))
    // Leave the row as it is: its heartbeat goes stale and the reconciler retries.
  } finally {
    following.delete(moveId)
  }
}

/** Start following a move without holding the request open. */
export function followMoveInBackground(moveId: string, tenantId: string): void {
  void runWithBackgroundTenant(tenantId, () => followMove(moveId)).catch(() => {})
}

/**
 * Moves whose follower went silent: claim each one (a conditional update on
 * the stale heartbeat, so two replicas cannot both take it) and follow it
 * again. A `queued` move never reached Proxmox: nothing was copied, close it.
 */
export async function reconcileMoves(now: Date = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - MOVE_STALE_AFTER_MS)
  const stale = await prisma.vdcMove.findMany({
    where: {
      status: { in: ['queued', 'copying', 'finalizing'] },
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }],
    },
    select: { id: true, status: true, tenantId: true, heartbeatAt: true },
    take: 20,
  })
  const holder = resolveInstanceId()
  let taken = 0
  for (const move of stale) {
    if (move.status === 'queued') {
      await fail(move.id, 'Interrupted before the copy started; the VM was not moved')
      continue
    }
    const { count } = await prisma.vdcMove.updateMany({
      where: { id: move.id, heartbeatAt: move.heartbeatAt },
      data: { holder, heartbeatAt: now },
    })
    if (count !== 1) continue
    taken++
    followMoveInBackground(move.id, move.tenantId)
  }

  return taken
}

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

/** Every replica starts it; the `vdc-moves` lease lets one of them reconcile at a time. */
export function startVdcMoveReconciler(): void {
  if (timer) return
  const holder = resolveInstanceId()
  const tick = async () => {
    if (inFlight) return
    inFlight = true
    try {
      if (!(await tryAcquireLease(LEASE_NAME, holder, LEASE_TTL_MS))) return
      const taken = await reconcileMoves()
      if (taken > 0) console.log(`[vdc-move] resumed ${taken} move(s) after their follower went silent`)
    } catch (err) {
      console.error('[vdc-move] reconcile failed:', err)
    } finally {
      inFlight = false
    }
  }
  timer = setInterval(() => { void tick() }, RECONCILE_INTERVAL_MS)
  timer.unref?.()
  setTimeout(() => { void tick() }, 15_000).unref?.()
  process.once('beforeExit', () => { releaseLease(LEASE_NAME, holder).catch(() => {}) })
}

/** Test hook. */
export function stopVdcMoveReconciler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
