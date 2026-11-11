// src/lib/vdc/vniCollisions.ts
// Audit of the VNIs carried on more than one cluster (#1334).
//
// Proxmox keeps a VNI unique inside one cluster only. As soon as an EVPN
// controller peers two clusters, frr advertises every local VNI, static
// VXLAN zones included, so two unrelated VNets holding the same VNI become
// one L2 domain. New networks are kept apart by the allocators; this module
// finds the collisions that already exist and moves a network to a free VNI.
//
// Provider only: the rows name clusters, zones, vDCs and tenants.

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { applySdn } from './sdn'
import { transportFromRow } from './transport'
import { pickVni } from './vniPolicy'

const ERR = 'VNI collision:'

export interface VniCollisionHolder {
  connectionId: string
  connectionName: string
  zone: string
  zoneType: string
  /** PVE VNet id, null for the VRF of an EVPN zone. */
  vnet: string | null
  alias: string | null
  /** The ProxCenter network behind the VNet, null for manual work. */
  vdcVnetId: string | null
  vdcName: string | null
  tenantName: string | null
  /** True when ProxCenter can move it to another VNI. */
  renumberable: boolean
}

export interface VniCollision {
  vni: number
  /** True when both sides sit on clusters running an EVPN controller: the leak is live. */
  exposed: boolean
  holders: VniCollisionHolder[]
}

interface LiveCluster {
  id: string
  name: string
  hasEvpnController: boolean
  zones: Map<string, { type: string; vrfVxlan: number | null }>
  vnets: Array<{ vnet: string; zone: string; tag: number; alias: string | null }>
}

async function readCluster(row: { id: string; name: string; tenantId: string }): Promise<LiveCluster | null> {
  try {
    const conn = await getConnectionById(row.id, row.tenantId)
    const [zones, vnets, controllers] = await Promise.all([
      pveFetch<any[]>(conn, '/cluster/sdn/zones'),
      pveFetch<any[]>(conn, '/cluster/sdn/vnets'),
      pveFetch<any[]>(conn, '/cluster/sdn/controllers').catch(() => []),
    ])
    return {
      id: row.id,
      name: row.name,
      hasEvpnController: (controllers || []).some((c: any) => c?.type === 'evpn'),
      zones: new Map((zones || []).map((z: any) => [String(z.zone), {
        type: String(z.type ?? ''),
        vrfVxlan: z['vrf-vxlan'] === undefined || z['vrf-vxlan'] === null ? null : Number(z['vrf-vxlan']),
      }])),
      vnets: (vnets || [])
        .filter((v: any) => Number.isInteger(Number(v.tag)))
        .map((v: any) => ({ vnet: String(v.vnet), zone: String(v.zone), tag: Number(v.tag), alias: v.alias ? String(v.alias) : null })),
    }
  } catch {
    return null
  }
}

interface Entry extends VniCollisionHolder {
  hasEvpnController: boolean
  /** Networks that share a VNI on purpose carry the same key. */
  sharedKey: string | null
}

/**
 * Every VNI that two clusters carry for unrelated networks. Sharing on
 * purpose is not a collision: the members of one stretched tenant network,
 * and the VNets of one EVPN zone (same zone id, same VRF VNI) on its
 * clusters. Three GETs per cluster, in parallel, on demand only.
 */
export async function auditVniCollisions(): Promise<{ collisions: VniCollision[]; unreachable: string[] }> {
  const connections = await prisma.connection.findMany({
    where: { type: 'pve' },
    select: { id: true, name: true, tenantId: true },
    orderBy: { name: 'asc' },
  })
  const read = await Promise.all(connections.map(readCluster))
  const unreachable = connections.filter((_c, i) => read[i] === null).map(c => c.name)
  const clusters = read.filter((c): c is LiveCluster => c !== null)

  const managed = await prisma.vdcVnet.findMany({
    where: { type: 'vxlan' },
    select: {
      id: true, pveName: true, displayName: true,
      tenantNetworkMember: { select: { tenantNetworkId: true } },
      vdc: { select: { name: true, connectionId: true, tenant: { select: { name: true } } } },
    },
  })
  const managedByKey = new Map(managed.map(v => [`${v.vdc.connectionId}/${v.pveName}`, v]))

  const byVni = new Map<number, Entry[]>()
  const push = (vni: number, entry: Entry) => {
    const list = byVni.get(vni)
    if (list) list.push(entry)
    else byVni.set(vni, [entry])
  }

  for (const cluster of clusters) {
    for (const v of cluster.vnets) {
      const zone = cluster.zones.get(v.zone)
      if (!zone || (zone.type !== 'vxlan' && zone.type !== 'evpn')) continue
      const row = managedByKey.get(`${cluster.id}/${v.vnet}`)
      const stretched = row?.tenantNetworkMember?.tenantNetworkId ?? null
      let sharedKey: string | null = null
      if (stretched) sharedKey = `tn:${stretched}`
      else if (zone.type === 'evpn') sharedKey = `evpn:${v.zone}:${zone.vrfVxlan}`
      push(v.tag, {
        connectionId: cluster.id,
        connectionName: cluster.name,
        zone: v.zone,
        zoneType: zone.type,
        vnet: v.vnet,
        alias: row?.displayName ?? v.alias,
        vdcVnetId: row?.id ?? null,
        vdcName: row?.vdc.name ?? null,
        tenantName: row?.vdc.tenant?.name ?? null,
        renumberable: !!row && !stretched && zone.type === 'vxlan',
        hasEvpnController: cluster.hasEvpnController,
        sharedKey,
      })
    }
    for (const [zoneName, zone] of cluster.zones) {
      if (zone.type !== 'evpn' || zone.vrfVxlan === null || !Number.isInteger(zone.vrfVxlan)) continue
      push(zone.vrfVxlan, {
        connectionId: cluster.id,
        connectionName: cluster.name,
        zone: zoneName,
        zoneType: 'evpn',
        vnet: null,
        alias: null,
        vdcVnetId: null,
        vdcName: null,
        tenantName: null,
        renumberable: false,
        hasEvpnController: cluster.hasEvpnController,
        sharedKey: `vrf:${zoneName}:${zone.vrfVxlan}`,
      })
    }
  }

  const collisions: VniCollision[] = []
  for (const [vni, entries] of byVni) {
    if (entries.length < 2) continue
    const first = entries[0].sharedKey
    if (first !== null && entries.every(e => e.sharedKey === first)) continue
    // One cluster alone cannot collide with itself: Proxmox refuses it, bar
    // a VNet sitting on the VRF VNI of an EVPN zone, which it accepts.
    const clustersInvolved = new Set(entries.map(e => e.connectionId))
    const vrfClash = entries.some(e => e.vnet === null) && entries.some(e => e.vnet !== null)
    if (clustersInvolved.size < 2 && !vrfClash) continue
    collisions.push({
      vni,
      exposed: entries.filter(e => e.hasEvpnController).length >= 2,
      holders: entries.map(({ hasEvpnController: _h, sharedKey: _s, ...holder }) => holder),
    })
  }
  collisions.sort((a, b) => a.vni - b.vni)
  return { collisions, unreachable }
}

export interface RenumberResult {
  vdcVnetId: string
  previousVni: number
  vni: number
}

/**
 * Moves a ProxCenter VXLAN network to a free VNI: the first free of the vDC
 * range, or the next free number. Proxmox rewrites the VXLAN interface on the
 * apply and keeps the guests plugged: a cut of a few seconds on the cluster.
 * One write and one SDN apply (a network reload on each node).
 */
export async function renumberVnet(vdcVnetId: string): Promise<RenumberResult> {
  const vnet = await prisma.vdcVnet.findUnique({
    where: { id: vdcVnetId },
    include: { vdc: true, tenantNetworkMember: { select: { id: true } } },
  })
  if (!vnet) throw new Error(`${ERR} network not found.`)
  if (vnet.type !== 'vxlan') throw new Error(`${ERR} only a VXLAN network carries a VNI.`)
  if (vnet.tenantNetworkMember) {
    throw new Error(`${ERR} a stretched tenant network keeps one VNI on every cluster and cannot be moved here.`)
  }

  const meta = await prisma.connection.findUnique({ where: { id: vnet.vdc.connectionId }, select: { tenantId: true } })
  if (!meta) throw new Error(`${ERR} cluster not found.`)
  const conn = await getConnectionById(vnet.vdc.connectionId, meta.tenantId)

  const vni = await pickVni({
    vdcId: vnet.vdcId,
    connectionId: vnet.vdc.connectionId,
    transport: transportFromRow(vnet.vdc as any),
    requested: null,
    conn,
  })

  const body = new URLSearchParams()
  body.append('tag', String(vni))
  try {
    await pveFetch(conn, `/cluster/sdn/vnets/${encodeURIComponent(vnet.pveName)}`, { method: 'PUT', body })
  } catch (err: any) {
    throw new Error(`Failed to update SDN VNet "${vnet.displayName ?? vnet.pveName}": ${err?.message}`)
  }
  await prisma.vdcVnet.update({ where: { id: vdcVnetId }, data: { tag: vni } })
  await applySdn(conn)
  return { vdcVnetId, previousVni: vnet.tag, vni }
}
