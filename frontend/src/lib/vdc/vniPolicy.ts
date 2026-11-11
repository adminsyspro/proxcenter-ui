// src/lib/vdc/vniPolicy.ts
// VNI choice of a tenant VXLAN network, scoped to the transport (roadmap#18).
//
// Proxmox refuses a VXLAN tag already carried by any VXLAN or EVPN VNet of
// the cluster (VxlanPlugin::vnet_update_hook), whatever zone holds it, and
// knows nothing of the other clusters. ProxCenter keeps a VNI unique across
// every cluster it manages (see takenVnisOnTransport): every VNet of every
// vDC, the live `/cluster/sdn/vnets` sets (legacy zones, manual work) and the
// tenant-wide reservations of stretched networks.
//
// On a shared transport the provider hands each vDC a VNI range and the
// tenant picks inside it, or lets ProxCenter take the first free number of
// the range. On a dedicated transport the tenant picks any valid VNI. Without
// a range on a shared transport the historical allocator (next above the
// highest tag) stays in charge and the tenant cannot choose.

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { allocateVni, listVnetsPve } from './sdn'
import { VNI_MAX, vniPolicyFor, type VdcTransport, type VniPolicy } from './transport'
import type { SdnVnet } from './types'

export class VniError extends Error {
  constructor(message: string, public readonly status: 400 | 409) {
    super(message)
    this.name = 'VniError'
  }
}

/** Accepts a number or a numeric string; null when absent. */
export function normalizeRequestedVni(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > VNI_MAX) {
    throw new VniError(`VNI must be an integer between 1 and ${VNI_MAX}.`, 400)
  }
  return n
}

/** Who holds a VNI; `label` is for the provider, never shown to a tenant. */
export interface VniHolder {
  /** The vDC of the network holding it, null outside any vDC. */
  vdcId: string | null
  network?: string
  label: string
}

/**
 * The VNets of the VXLAN / EVPN zones of one cluster, as Proxmox runs them.
 * Only those zones compete for the VNI space: a VLAN VNet's tag 200 must not
 * block VNI 200. Without the zone list every tagged VNet is kept.
 */
async function liveOverlayVnets(conn: any): Promise<SdnVnet[]> {
  const zones = await pveFetch<any[]>(conn, '/cluster/sdn/zones').catch(() => null)
  const overlayZones = zones
    ? new Set(zones.filter((z: any) => z?.type === 'vxlan' || z?.type === 'evpn').map((z: any) => String(z.zone)))
    : null
  return (await listVnetsPve(conn)).filter(v =>
    Number.isFinite(v.tag) && (!overlayZones || overlayZones.has(String(v.zone))))
}

/**
 * Every VNI a new network on `connectionId` must avoid, with who holds it.
 *
 * The scope is every Proxmox cluster ProxCenter manages, not the cluster of
 * the vDC alone. Proxmox only refuses a tag already carried on the same
 * cluster, but an EVPN controller peering two clusters advertises every
 * local VNI (`advertise-all-vni`), static VXLAN zones included: the same VNI
 * on two clusters then becomes one L2 domain, whoever owns each side.
 *
 * Holders: the VXLAN VNets ProxCenter created (those of this cluster first,
 * so a tenant is told about its own network), the stretched tenant networks,
 * whose VNI is reserved everywhere, and the live tag set of the VXLAN / EVPN
 * zones of each cluster (legacy zones, manual work). The live reads are best
 * effort: an unreachable cluster leaves the database and the PVE 400.
 */
export async function takenVnisOnTransport(connectionId: string, conn?: any): Promise<Map<number, VniHolder>> {
  const taken = new Map<number, VniHolder>()

  const vnets = await prisma.vdcVnet.findMany({
    where: { type: 'vxlan' },
    select: { tag: true, displayName: true, pveName: true, vdcId: true, vdc: { select: { name: true, connectionId: true } } },
  })
  const local = vnets.filter(v => v.vdc.connectionId === connectionId)
  const remote = vnets.filter(v => v.vdc.connectionId !== connectionId)
  for (const v of [...local, ...remote]) {
    if (!taken.has(v.tag)) {
      taken.set(v.tag, { vdcId: v.vdcId, network: v.displayName ?? v.pveName, label: `network "${v.displayName ?? v.pveName}" of vDC "${v.vdc.name}"` })
    }
  }

  const networks = await prisma.tenantNetwork.findMany({ select: { vni: true, name: true } })
  for (const n of networks) if (!taken.has(n.vni)) taken.set(n.vni, { vdcId: null, label: `tenant network "${n.name}"` })

  if (conn) {
    try {
      for (const v of await liveOverlayVnets(conn)) {
        if (!taken.has(v.tag)) taken.set(v.tag, { vdcId: null, label: `VNet "${v.vnet}" of zone "${v.zone}" on the cluster` })
      }
    } catch {
      // Best effort, see above.
    }
  }

  // Two light GETs per other cluster, in parallel, on a network creation.
  const others = await prisma.connection.findMany({
    where: { type: 'pve', id: { not: connectionId } },
    select: { id: true, name: true, tenantId: true },
  })
  const liveElsewhere = await Promise.all(others.map(async c => {
    try {
      return { name: c.name, vnets: await liveOverlayVnets(await getConnectionById(c.id, c.tenantId)) }
    } catch {
      return { name: c.name, vnets: [] as SdnVnet[] }
    }
  }))
  for (const cluster of liveElsewhere) {
    for (const v of cluster.vnets) {
      if (!taken.has(v.tag)) taken.set(v.tag, { vdcId: null, label: `VNet "${v.vnet}" of zone "${v.zone}" on cluster "${cluster.name}"` })
    }
  }
  return taken
}

/**
 * The VNI ranges the provider handed to the OTHER vDCs of the connection:
 * reserved for them, so neither a tenant choice nor the automatic allocator
 * of a vDC without a range may land inside one.
 */
export async function reservedRangesOnTransport(connectionId: string, vdcId: string): Promise<Array<{ start: number; end: number; vdcName: string }>> {
  const rows = await prisma.vdc.findMany({
    where: { connectionId, id: { not: vdcId }, vniRangeStart: { not: null } },
    select: { name: true, vniRangeStart: true, vniRangeEnd: true },
  })
  return rows
    .filter(r => r.vniRangeStart !== null && r.vniRangeEnd !== null)
    .map(r => ({ start: r.vniRangeStart!, end: r.vniRangeEnd!, vdcName: r.name }))
}

function isReserved(vni: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some(r => vni >= r.start && vni <= r.end)
}

/**
 * The refusal a tenant reads for a VNI already taken. It names the holder
 * only when it is a network of the tenant's own vDC: the networks, vDCs,
 * zones and ranges of the other tenants of the cluster stay private.
 */
function takenMessage(vni: number, vdcId: string, holder: VniHolder | undefined): string {
  if (holder?.vdcId === vdcId) return `VNI ${vni} is already used by your network "${holder.network}".`
  return `VNI ${vni} is already in use on this transport.`
}

export interface PickVniInput {
  vdcId: string
  connectionId: string
  transport: VdcTransport
  /** The VNI the tenant typed, null for automatic. */
  requested: number | null
  /** PVE connection for the live tag set; optional in tests. */
  conn?: any
}

function rangeText(policy: VniPolicy): string {
  return policy.range ? `${policy.range.start}-${policy.range.end}` : ''
}

/**
 * The VNI of a new VXLAN network of the vDC. Throws a VniError carrying the
 * HTTP status the route should answer: 400 for a choice the policy refuses,
 * 409 for a collision on the transport or an exhausted range.
 */
export async function pickVni(input: PickVniInput): Promise<number> {
  const policy = vniPolicyFor(input.transport)

  if (input.requested !== null) {
    const vni = input.requested
    if (!policy.tenantChoice) {
      throw new VniError('Your provider has not assigned a VNI range to this vDC: the VNI is allocated automatically, leave it empty.', 400)
    }
    if (policy.range && (vni < policy.range.start || vni > policy.range.end)) {
      throw new VniError(`VNI ${vni} is outside the range ${rangeText(policy)} assigned to your vDC on this transport.`, 400)
    }
    const taken = await takenVnisOnTransport(input.connectionId, input.conn)
    const holder = taken.get(vni)
    if (holder || isReserved(vni, await reservedRangesOnTransport(input.connectionId, input.vdcId))) {
      throw new VniError(takenMessage(vni, input.vdcId, holder), 409)
    }
    return vni
  }

  const taken = await takenVnisOnTransport(input.connectionId, input.conn)
  if (policy.range) {
    for (let vni = policy.range.start; vni <= policy.range.end; vni++) {
      if (!taken.has(vni)) return vni
    }
    throw new VniError(`No free VNI left in the range ${rangeText(policy)} assigned to your vDC.`, 409)
  }

  // Dedicated transport without a choice, or shared transport without a
  // range: the historical allocator, next number above everything taken,
  // stepping over the ranges reserved for the other vDCs of the cluster.
  const reserved = await reservedRangesOnTransport(input.connectionId, input.vdcId)
  let vni = await allocateVni(input.vdcId, input.conn)
  while (vni <= VNI_MAX && (taken.has(vni) || isReserved(vni, reserved))) vni++
  if (vni > VNI_MAX) throw new VniError(`No free VNI left below ${VNI_MAX} on this transport.`, 409)
  return vni
}
