// src/lib/vdc/ipamSync.ts
//
// Reconciliation helper invoked by every code path that mutates a VM's
// network config — PUT config (tenant edits MAC/IP/bridge), clone (PVE
// generates a fresh MAC), restore (qmrestore reinjects the saved
// netN+ipconfigN). It compares the "before" and "after" snapshots of
// the qm config and adjusts the IPAM DB accordingly:
//
//   - NIC removed / bridge moved off an IPAM-managed VNet → release
//   - NIC added / bridge moved onto an IPAM-managed VNet → allocate
//   - same VNet, different MAC → release old, allocate with new MAC
//   - same VNet, same MAC, different IP → release old, allocate with hint
//
// When the allocator returns an IP that differs from what the caller
// asked PVE for (auto-pick path or hint conflict resolution), we surface
// the corrected ipconfigN in `bodyOverrides` so the caller can patch
// the PVE PUT body before sending it. This keeps PVE's qm config and
// our IPAM DB in lock-step.
//
// Rollback contract: every release/allocate is journalled; if the
// caller's pveFetch fails after the sync, calling `rollback()` undoes
// the IPAM mutations in reverse order. Allocator errors short-circuit
// with the partial rollback already applied before throwing.
//
// No-op outside vDCs: when no netN slot resolves to an IPAM-managed
// VNet (i.e. resolveSubnetForBridge returns null for every bridge in
// before+after) and the VM has no existing IPAM allocation, the helper
// returns immediately. So community-mode installs (no vDCs) and any
// non-vDC bridge usage pay zero cost — same guarantee the deploy hook
// already gives.

import {
  allocateIp,
  releaseIp,
  releaseByMac,
  findAllocationsForVm,
  IpamHintUnavailableError,
  IpamExhaustedError,
  type IpamAllocation,
} from './ipam'
import {
  parseNetLine,
  parseIpconfigLine,
  scanUsedIpsForSubnet,
  scannedToIntSet,
} from './ipamScan'
import { resolveSubnetForBridge, type SubnetForBridge } from './vnets'
import { ipInCidrUsable, parseCidr } from './network'

import type { ProxmoxClientOptions } from '@/lib/proxmox/client'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PveConfigShape = Record<string, any>

export interface SyncIpamArgs {
  /** PVE config before the mutation, or null if the VM didn't exist
   *  (clone target, restore target). */
  before: PveConfigShape | null
  /** PVE config the caller is about to push (or has just received from
   *  PVE in the case of clone/restore). All netN/ipconfigN slots that
   *  matter must be present here. */
  after: PveConfigShape
  conn: ProxmoxClientOptions
  connectionId: string
  vmid: number
  hostname: string | null
}

export interface SyncIpamResult {
  /** Map of `ipconfigN` (or other) keys to overwrite in the PUT body
   *  before sending to PVE. Empty when the after-snapshot's ipconfigN
   *  already matches the IPAM-allocated IP. */
  bodyOverrides: Record<string, string>
  /** Compensating action — invoke if the caller's PVE write fails after
   *  the sync. Replays the IPAM mutations in reverse order so the DB
   *  ends up consistent with the unchanged PVE config. */
  rollback: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface NicSlot {
  index: number
  bridge: string | null
  mac: string | null
  ipFromIpconfig: string | null
}

function readNicSlot(cfg: PveConfigShape | null, index: number): NicSlot {
  if (!cfg) return { index, bridge: null, mac: null, ipFromIpconfig: null }
  const netVal = cfg[`net${index}`]
  if (netVal == null || String(netVal) === '') return { index, bridge: null, mac: null, ipFromIpconfig: null }
  const { bridge, mac } = parseNetLine(String(netVal))
  const { ip } = parseIpconfigLine(String(cfg[`ipconfig${index}`] ?? ''))
  return { index, bridge, mac, ipFromIpconfig: ip }
}

function nicSlotIndexes(cfg: PveConfigShape | null): number[] {
  if (!cfg) return []
  const out: number[] = []
  for (const key of Object.keys(cfg)) {
    const m = /^net(\d+)$/.exec(key)
    if (m) out.push(Number(m[1]))
  }
  return out
}

interface JournalEntry {
  /** Inverse op recorded at apply time. Idempotent. Async because the
   *  underlying release/allocate helpers became async after the Postgres
   *  cutover. */
  undo: () => Promise<void>
}

/**
 * Build the inverse of an allocateIp call — release the IP we just
 * inserted. Idempotent: if the row got cleaned up by another path the
 * undo just no-ops.
 */
function undoAllocate(_connectionId: string, subnetId: string, ip: string): JournalEntry {
  return {
    undo: async () => {
      try { await releaseIp({ subnetId, ip }) } catch { /* tolerate */ }
    },
  }
}

/**
 * Build the inverse of a releaseByMac/releaseIp call — re-allocate the
 * IP for the original MAC (idempotent on the (subnet, mac) UNIQUE).
 */
function undoRelease(args: {
  vdcId: string
  subnetId: string
  vnetId: string
  connectionId: string
  mac: string
  ip: string
  vmid: number | null
  hostname: string | null
}): JournalEntry {
  return {
    undo: async () => {
      try {
        await allocateIp({
          vdcId: args.vdcId,
          subnetId: args.subnetId,
          vnetId: args.vnetId,
          connectionId: args.connectionId,
          mac: args.mac,
          vmid: args.vmid,
          hostname: args.hostname,
          hint: args.ip,
        })
      } catch {
        /* tolerate — rollback is best-effort */
      }
    },
  }
}

function buildIpconfigValue(ip: string, cidr: string, gateway: string): string {
  const prefix = parseCidr(cidr)?.prefix
  const ipPart = prefix !== undefined ? `${ip}/${prefix}` : ip
  return `ip=${ipPart},gw=${gateway}`
}

/** Cache scan results inside one sync call so we don't refetch for slots
 *  that share a subnet. The module-level cache in ipamScan.ts already
 *  handles cross-call caching (60s TTL); this is a per-invocation memo. */
async function scanSubnetOnce(
  memo: Map<string, Set<number>>,
  args: { conn: ProxmoxClientOptions; connectionId: string; subnet: SubnetForBridge },
): Promise<Set<number>> {
  const key = args.subnet.subnetId
  const hit = memo.get(key)
  if (hit) return hit
  const scanned = await scanUsedIpsForSubnet({
    conn: args.conn,
    vdcPoolName: args.subnet.pvePoolName,
    vnetPveName: args.subnet.pveName,
    subnetId: args.subnet.subnetId,
    connectionId: args.connectionId,
  })
  const set = scannedToIntSet(scanned)
  memo.set(key, set)
  return set
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile the IPAM DB with the after-snapshot of a VM's PVE config.
 * Returns the body overrides the caller must patch into the PVE PUT
 * (typically `ipconfigN=...`) and a rollback hook for failure paths.
 */
export async function syncIpamForVmConfig(args: SyncIpamArgs): Promise<SyncIpamResult> {
  const journal: JournalEntry[] = []
  const bodyOverrides: Record<string, string> = {}

  // No-op shortcut: every relevant netN slot resolves to no IPAM-managed
  // subnet on either side AND the VM has no existing IPAM allocation.
  // Cheap to check and means installs without vDCs pay nothing.
  const beforeIdx = nicSlotIndexes(args.before)
  const afterIdx = nicSlotIndexes(args.after)
  const allIdx = Array.from(new Set([...beforeIdx, ...afterIdx])).sort((a, b) => a - b)

  if (allIdx.length === 0) {
    return { bodyOverrides, rollback: async () => undefined }
  }

  // Memoise per-subnet scan results across slots to avoid double-fetching
  // when two NICs sit on the same VNet.
  const scanMemo = new Map<string, Set<number>>()

  // Snapshot the VM's existing allocations so a release-by-MAC has the
  // metadata it needs to rollback (vdcId, vnetId, etc. aren't in the
  // PVE config).
  const existingAllocs = await findAllocationsForVm(args.connectionId, args.vmid)
  const allocByMac = new Map<string, IpamAllocation>()
  for (const a of existingAllocs) allocByMac.set(a.mac.toUpperCase(), a)

  // No external trigger and no allocations to reconcile → nothing to do.
  if (existingAllocs.length === 0) {
    let anyIpamRelevantSlot = false
    for (const idx of allIdx) {
      const beforeSlot = readNicSlot(args.before, idx)
      const afterSlot = readNicSlot(args.after, idx)
      const beforeSubnet = beforeSlot.bridge ? await resolveSubnetForBridge(args.connectionId, beforeSlot.bridge) : null
      const afterSubnet = afterSlot.bridge ? await resolveSubnetForBridge(args.connectionId, afterSlot.bridge) : null
      if (beforeSubnet || afterSubnet) { anyIpamRelevantSlot = true; break }
    }
    if (!anyIpamRelevantSlot) {
      return { bodyOverrides, rollback: async () => undefined }
    }
  }

  const rollback = async () => {
    // Replay undos in reverse — releases first, allocates second so the
    // (subnet, ip) UNIQUE doesn't trip.
    for (let i = journal.length - 1; i >= 0; i--) {
      await journal[i].undo()
    }
  }

  try {
    for (const idx of allIdx) {
      const beforeSlot = readNicSlot(args.before, idx)
      const afterSlot = readNicSlot(args.after, idx)
      const beforeSubnet = beforeSlot.bridge ? await resolveSubnetForBridge(args.connectionId, beforeSlot.bridge) : null
      const afterSubnet = afterSlot.bridge ? await resolveSubnetForBridge(args.connectionId, afterSlot.bridge) : null

      // Both sides outside IPAM-managed VNets — nothing to do for this slot.
      if (!beforeSubnet && !afterSubnet) continue

      // === Release path ===
      // Whenever the slot moves off an IPAM-managed VNet, OR the MAC
      // changes (so the old MAC's allocation is stale), drop the old row.
      const macBefore = beforeSlot.mac?.toUpperCase() ?? null
      const macAfter = afterSlot.mac?.toUpperCase() ?? null

      const wasIpamManaged = !!beforeSubnet && !!macBefore
      const stillSameAllocation =
        wasIpamManaged &&
        !!afterSubnet &&
        afterSubnet.subnetId === beforeSubnet!.subnetId &&
        macAfter === macBefore

      if (wasIpamManaged && !stillSameAllocation) {
        // Find the row we're about to nuke so we can remember its IP for
        // the rollback (re-allocate with hint=ip recreates the same row).
        const stale = allocByMac.get(macBefore!)
        if (stale && stale.subnetId === beforeSubnet!.subnetId) {
          await releaseByMac({ subnetId: beforeSubnet!.subnetId, mac: macBefore! })
          journal.push(undoRelease({
            vdcId: stale.vdcId,
            subnetId: stale.subnetId,
            vnetId: stale.vnetId,
            connectionId: stale.connectionId,
            mac: stale.mac,
            ip: stale.ip,
            vmid: stale.vmid,
            hostname: stale.hostname,
          }))
        }
      }

      // === Allocate path ===
      if (afterSubnet && macAfter) {
        const externalIps = await scanSubnetOnce(scanMemo, {
          conn: args.conn,
          connectionId: args.connectionId,
          subnet: afterSubnet,
        })

        // If the slot is unchanged at the netN level but the user changed
        // ipconfigN.ip, we honour the new IP by releasing the existing
        // allocation first (it's the same MAC) and re-allocating with the
        // hint. allocateIp's idempotency on (subnet, mac) means a plain
        // re-call wouldn't honour the new hint; we explicitly clear it.
        if (stillSameAllocation && afterSlot.ipFromIpconfig && allocByMac.get(macAfter!)?.ip !== afterSlot.ipFromIpconfig) {
          const old = allocByMac.get(macAfter!)
          if (old) {
            await releaseByMac({ subnetId: afterSubnet.subnetId, mac: macAfter! })
            journal.push(undoRelease({
              vdcId: old.vdcId,
              subnetId: old.subnetId,
              vnetId: old.vnetId,
              connectionId: old.connectionId,
              mac: old.mac,
              ip: old.ip,
              vmid: old.vmid,
              hostname: old.hostname,
            }))
          }
        }

        // A stale ipconfigN inherited from `before` must not steer the
        // allocator when the NIC just moved to another subnet (bridge
        // change): honour the hint only when it actually belongs to the
        // target subnet, otherwise fall back to auto-pick and let the
        // bodyOverrides correction below rewrite ipconfigN.
        const rawHint = afterSlot.ipFromIpconfig ?? undefined
        const hint = rawHint && ipInCidrUsable(rawHint, afterSubnet.cidr) ? rawHint : undefined
        const allocated = await allocateIp({
          vdcId: afterSubnet.vdcId,
          subnetId: afterSubnet.subnetId,
          vnetId: afterSubnet.vnetId,
          connectionId: args.connectionId,
          mac: macAfter,
          vmid: args.vmid,
          hostname: args.hostname,
          hint,
          externalIps,
        })
        journal.push(undoAllocate(args.connectionId, afterSubnet.subnetId, allocated.ip))

        // If the IP we got differs from what the after-snapshot says
        // (auto-pick or hint that lived in `before` not `after`), surface
        // the correction so the caller injects the right ipconfigN into
        // the PVE PUT.
        if (allocated.ip !== afterSlot.ipFromIpconfig) {
          bodyOverrides[`ipconfig${idx}`] = buildIpconfigValue(
            allocated.ip,
            afterSubnet.cidr,
            afterSubnet.gateway,
          )
        }
      }
    }
  } catch (err) {
    // Auto-rollback on any failure during the apply phase — we don't
    // want to leak partial mutations to the caller's catch block.
    await rollback()
    throw err
  }

  return { bodyOverrides, rollback }
}

// Re-export the error types so callers can catch them by reference.
export { IpamHintUnavailableError, IpamExhaustedError }
