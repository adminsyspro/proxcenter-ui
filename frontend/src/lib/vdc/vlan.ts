// src/lib/vdc/vlan.ts
// Per-vDC VLAN pools + tag allocation + shared per-(connection, bridge) VLAN zones.

import crypto from 'crypto'
import { randomUUID } from 'crypto'

import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { createZone, listVnetsPve } from './sdn'

export interface VlanPoolInput { bridge: string; rangeStart: number; rangeEnd: number }

const VLAN_MIN = 1
// PVE accepts up to 4096 but 0 and 4095 are 802.1Q-reserved; we stop at 4094.
const VLAN_MAX = 4094

function rangesOverlap(a: VlanPoolInput, b: VlanPoolInput): boolean {
  return a.bridge === b.bridge && a.rangeStart <= b.rangeEnd && b.rangeStart <= a.rangeEnd
}

export function validateVlanPoolsInput(pools: VlanPoolInput[]): void {
  for (const p of pools) {
    if (
      !Number.isInteger(p.rangeStart) || !Number.isInteger(p.rangeEnd) ||
      p.rangeStart < VLAN_MIN || p.rangeEnd > VLAN_MAX || p.rangeStart > p.rangeEnd
    ) {
      throw new Error(`VLAN pool range ${p.rangeStart}-${p.rangeEnd} is invalid (bounds 1-4094, start <= end)`)
    }
    if (!p.bridge || typeof p.bridge !== 'string') {
      throw new Error(`VLAN pool range ${p.rangeStart}-${p.rangeEnd} is invalid (bounds 1-4094, start <= end)`)
    }
  }
  for (let i = 0; i < pools.length; i++) {
    for (let j = i + 1; j < pools.length; j++) {
      if (rangesOverlap(pools[i], pools[j])) {
        throw new Error(
          `VLAN pool ranges ${pools[i].rangeStart}-${pools[i].rangeEnd} and ` +
          `${pools[j].rangeStart}-${pools[j].rangeEnd} overlap on bridge "${pools[i].bridge}"`
        )
      }
    }
  }
}

/** Refuse pools that overlap another vDC's pools on the same (connection, bridge).
 *  Same guard-then-friendly-message pattern as the VMID range of #647: the check
 *  runs outside a transaction (provider-only, single-admin operation). */
export async function assertNoCrossVdcOverlap(
  connectionId: string,
  vdcId: string | null,
  pools: VlanPoolInput[],
): Promise<void> {
  if (pools.length === 0) return
  const others = await prisma.vdcVlanPool.findMany({
    where: {
      vdc: { connectionId },
      ...(vdcId ? { vdcId: { not: vdcId } } : {}),
    },
    select: { bridge: true, rangeStart: true, rangeEnd: true, vdc: { select: { name: true } } },
  })
  for (const p of pools) {
    for (const o of others) {
      if (rangesOverlap(p, { bridge: o.bridge, rangeStart: o.rangeStart, rangeEnd: o.rangeEnd })) {
        throw new Error(
          `VLAN pool ${p.rangeStart}-${p.rangeEnd} on bridge "${p.bridge}" ` +
          `overlaps vDC "${o.vdc.name}" (${o.rangeStart}-${o.rangeEnd})`
        )
      }
    }
  }
}

/** Refuse a pool update that would strand an existing VLAN VNet outside the new ranges. */
export async function assertPoolShrinkSafe(vdcId: string, pools: VlanPoolInput[]): Promise<void> {
  const vnets = await prisma.vdcVnet.findMany({
    where: { vdcId, type: 'vlan' },
    select: { displayName: true, pveName: true, bridge: true, tag: true },
  })
  for (const v of vnets) {
    const covered = pools.some(p => p.bridge === v.bridge && v.tag >= p.rangeStart && v.tag <= p.rangeEnd)
    if (!covered) {
      throw new Error(
        `Cannot shrink VLAN pools: VNet "${v.displayName ?? v.pveName}" uses tag ${v.tag} on bridge "${v.bridge}"`
      )
    }
  }
}

/** Deterministic 8-char PVE zone id for the shared (connection, bridge) VLAN zone. */
export function generateVlanZoneName(connectionId: string, bridge: string): string {
  const hash = crypto.createHash('sha1').update(`${connectionId}:${bridge}`).digest('hex').slice(0, 6)
  return `vl${hash}`
}

/** Lazily creates the shared VLAN zone for (connection, bridge). Provider-owned,
 *  never auto-deleted: PVE's per-zone tag uniqueness is the L2-leak backstop
 *  (two zones on the same bridge may carry the same tag, one zone may not). */
export async function ensureVlanZone(conn: any, connectionId: string, bridge: string): Promise<string> {
  const existing = await prisma.sdnVlanZone.findUnique({
    where: { connectionId_bridge: { connectionId, bridge } },
    select: { zoneName: true },
  })
  if (existing) return existing.zoneName

  const zoneName = generateVlanZoneName(connectionId, bridge)
  // PVE first (createZone tolerates "already exists"), then the DB row; a
  // concurrent create converges on the same deterministic name via P2002.
  await createZone(conn, zoneName, { type: 'vlan', bridge })
  try {
    await prisma.sdnVlanZone.create({ data: { id: randomUUID(), connectionId, bridge, zoneName } })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const row = await prisma.sdnVlanZone.findUnique({
        where: { connectionId_bridge: { connectionId, bridge } },
        select: { zoneName: true },
      })
      if (row) return row.zoneName
    }
    throw err
  }
  return zoneName
}

/** Allocates a VLAN tag inside the vDC's pools for `bridge`.
 *  Excluded: tags of every ProxCenter VLAN VNet on the same (connection, bridge)
 *  regardless of tenant, plus tags PVE actually carries on that bridge across
 *  ALL zones (PVE does not protect across zones, so a provider-made zone on the
 *  same bridge holds tags our DB cannot see). Freed tags are reused: unlike
 *  VNIs, the resource is scarce (provider-bounded ranges). */
export async function allocateVlanTag(args: {
  vdcId: string
  connectionId: string
  bridge: string
  requestedTag?: number | null
  conn?: any
}): Promise<number> {
  const pools = await prisma.vdcVlanPool.findMany({
    where: { vdcId: args.vdcId, bridge: args.bridge },
    orderBy: { rangeStart: 'asc' },
    select: { rangeStart: true, rangeEnd: true },
  })
  if (pools.length === 0) {
    throw new Error(`Bridge "${args.bridge}" has no VLAN pool in this vDC`)
  }

  const taken = new Set<number>()
  const dbRows = await prisma.vdcVnet.findMany({
    where: { type: 'vlan', bridge: args.bridge, vdc: { connectionId: args.connectionId } },
    select: { tag: true },
  })
  for (const r of dbRows) taken.add(r.tag)

  if (args.conn) {
    try {
      const zones = await pveFetch<any[]>(args.conn, '/cluster/sdn/zones') || []
      const zonesOnBridge = new Set(
        zones.filter((z: any) => z.type === 'vlan' && String(z.bridge) === args.bridge).map((z: any) => String(z.zone))
      )
      if (zonesOnBridge.size > 0) {
        const vnets = await listVnetsPve(args.conn)
        for (const v of vnets) {
          if (zonesOnBridge.has(v.zone) && Number.isFinite(v.tag)) taken.add(v.tag)
        }
      }
    } catch {
      // Best-effort, same stance as allocateVni: DB-side allocation beats
      // failing every VNet creation when the SDN endpoint is unreachable.
    }
  }

  const inPools = (tag: number) => pools.some(p => tag >= p.rangeStart && tag <= p.rangeEnd)

  if (args.requestedTag != null) {
    const tag = args.requestedTag
    if (!inPools(tag)) {
      throw new Error(`VLAN tag ${tag} is outside the vDC pools for bridge "${args.bridge}"`)
    }
    if (taken.has(tag)) {
      throw new Error(`VLAN tag ${tag} is already in use on bridge "${args.bridge}"`)
    }
    return tag
  }

  for (const p of pools) {
    for (let tag = p.rangeStart; tag <= p.rangeEnd; tag++) {
      if (!taken.has(tag)) return tag
    }
  }
  throw new Error(`No free VLAN tag left in the vDC pools for bridge "${args.bridge}"`)
}
