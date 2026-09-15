// src/lib/vdc/transportOps.ts
// Zone status, zone sync and transport-network provisioning for a vDC (#899).
// Everything here talks to Proxmox on purpose; the pure rules live in
// ./transport.ts and the CRUD in ./index.ts.

import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'

import { applySdn, createZone, listClusterNodeIps, readZonePve, updateZone, type PveZoneLive } from './sdn'
import {
  parseCidr,
  parseZonePeers,
  sameZoneConfig,
  transportConflict,
  transportFromRow,
  transportIfaceName,
  underlayMtuFor,
  zoneConfigFor,
  type TransportConflict,
  type VdcTransport,
  type ZoneConfig,
} from './transport'
import { memberPeersForVdc, withMemberPeers } from './stretchPeers'

/**
 * Wording of a transport conflict. Carries "is in use by vDC" so the route
 * layer answers 409 rather than the 400 of a malformed transport.
 */
function conflictMessage(conflict: TransportConflict, iface: string, cidr: string | null, otherName: string): string {
  const head = `VXLAN transport: `
  const owner = `is in use by vDC "${otherName}"`
  switch (conflict.reason) {
    case 'sharedSegment':
      return `${head}segment ${cidr} ${owner} on interface "${conflict.detail}". A node cannot carry one segment on two interfaces.`
    case 'segment':
      return `${head}interface "${iface}" ${owner} with segment ${conflict.detail}. Two vDCs may share a transport segment, but only with the same definition.`
    case 'mtu':
      return `${head}interface "${iface}" ${owner} with ${conflict.detail === 'the Proxmox default' ? conflict.detail : `a zone MTU of ${conflict.detail}`}. The interface carries one MTU for both.`
    case 'nodeAddress':
      return `${head}interface "${iface}" ${owner}, which gives node "${conflict.node}" the address ${conflict.detail}.`
    case 'addressReuse':
      return `${head}interface "${iface}" ${owner}, which gives the address ${conflict.detail} to node "${conflict.node}".`
  }
}

/**
 * Refuses a transport that another vDC of the same cluster would fight over
 * (#899). Called before any write, so a refusal leaves both Proxmox and the
 * stored row untouched. Sharing a segment stays allowed as long as every
 * vDC on it describes it the same way.
 */
export async function assertNoTransportConflict(
  connectionId: string,
  vdcId: string | null,
  transport: VdcTransport,
): Promise<void> {
  if (transport.mode !== 'transport') return
  const iface = transportIfaceName(transport)
  if (!iface) return

  const others = await prisma.vdc.findMany({
    where: {
      connectionId,
      vxlanTransportMode: 'transport',
      ...(vdcId ? { id: { not: vdcId } } : {}),
    },
    select: {
      name: true,
      vxlanTransportMode: true, vxlanPeers: true, vxlanMtu: true,
      transportVlanId: true, transportDevice: true, transportCidr: true, transportNodeAddresses: true,
    },
  })

  for (const other of others) {
    const conflict = transportConflict(transport, transportFromRow(other))
    if (conflict) throw new Error(conflictMessage(conflict, iface, transport.cidr, other.name))
  }
}

export interface VdcZoneStatus {
  zoneName: string | null
  /** What the stored transport asks for. */
  desired: ZoneConfig
  /** What Proxmox runs, with its staged changes. Null when the zone is gone. */
  live: PveZoneLive | null
  /** Desired equals the zone Proxmox will run once its staged changes are applied. */
  inSync: boolean
}

async function loadVdcForTransport(id: string) {
  const row = await prisma.vdc.findUnique({
    where: { id },
    select: {
      id: true, connectionId: true, sdnZoneName: true, slug: true,
      vxlanTransportMode: true, vxlanPeers: true, vxlanMtu: true,
      transportVlanId: true, transportDevice: true, transportCidr: true, transportNodeAddresses: true,
    },
  })
  if (!row) throw new Error(`vDC not found: ${id}`)
  // The connection's owner tenant may differ from the vDC's tenant.
  const owner = await prisma.connection.findUnique({ where: { id: row.connectionId }, select: { tenantId: true } })
  if (!owner) throw new Error(`Connection not found: ${row.connectionId}`)
  const conn = await getConnectionById(row.connectionId, owner.tenantId)
  return { row, transport: transportFromRow(row), conn }
}

/**
 * The zone as it will run after the next SDN apply: with `pending=1` PVE
 * reports the running values at the top level and the staged ones under
 * `pending`, a removed property showing as the string `deleted`.
 */
export function effectiveZoneConfig(live: PveZoneLive): ZoneConfig {
  const pending = live.pending ?? {}
  let peers = live.peers
  if ('peers' in pending) peers = pending.peers === 'deleted' ? [] : parseZonePeers(pending.peers)
  let mtu = live.mtu
  if ('mtu' in pending) {
    const raw = pending.mtu
    mtu = raw === 'deleted' || raw === undefined || raw === null || raw === '' ? null : Number(raw)
  }
  return { peers, mtu }
}

async function computeZoneStatus(conn: any, zoneName: string | null, transport: VdcTransport, vdcId: string): Promise<VdcZoneStatus> {
  const clusterIps = transport.mode === 'cluster' ? await listClusterNodeIps(conn) : []
  // The other members of a stretched tenant network (#901) ride on this
  // zone too; without them a sync would strip their peers.
  const desired = withMemberPeers(zoneConfigFor(transport, clusterIps), await memberPeersForVdc(vdcId))
  const live = zoneName ? await readZonePve(conn, zoneName) : null
  const inSync = !!live && sameZoneConfig(desired, effectiveZoneConfig(live))
  return { zoneName, desired, live, inSync }
}

export async function getVdcZoneStatus(id: string): Promise<VdcZoneStatus> {
  const { row, transport, conn } = await loadVdcForTransport(id)
  return computeZoneStatus(conn, row.sdnZoneName, transport, row.id)
}

/**
 * Bring the Proxmox zone back to the stored transport: rewrite peers and
 * MTU when they differ, recreate the zone when it is gone, then apply.
 * This is also how a `cluster` mode zone picks up a node that joined after
 * the vDC was created. Returns the status after the operation.
 */
export async function syncVdcZone(id: string): Promise<VdcZoneStatus & { changed: boolean }> {
  const { row, transport, conn } = await loadVdcForTransport(id)
  if (!row.sdnZoneName) throw new Error('This vDC has no SDN zone.')
  const before = await computeZoneStatus(conn, row.sdnZoneName, transport, row.id)

  if (before.inSync && !before.live?.state) return { ...before, changed: false }

  if (!before.live) {
    await createZone(conn, row.sdnZoneName, { peers: before.desired.peers, mtu: before.desired.mtu })
  } else if (!before.inSync) {
    await updateZone(conn, row.sdnZoneName, before.desired)
  }
  await applySdn(conn)

  const after = await computeZoneStatus(conn, row.sdnZoneName, transport, row.id)
  return { ...after, changed: true }
}

interface TransportTarget {
  iface: string
  cidrKey: 'cidr' | 'cidr6'
  prefix: number
  /** MTU the VLAN interface must carry, null when the zone leaves it to PVE. */
  mtu: number | null
}

function transportTarget(transport: VdcTransport): TransportTarget {
  if (transport.mode !== 'transport') {
    throw new Error('VXLAN transport: the vDC is not in transport network mode.')
  }
  const iface = transportIfaceName(transport)
  const cidr = transport.cidr ? parseCidr(transport.cidr) : null
  if (!iface || !cidr) throw new Error('VXLAN transport: the transport network is incomplete.')
  return { iface, cidrKey: cidr.family === 4 ? 'cidr' : 'cidr6', prefix: cidr.prefix, mtu: underlayMtuFor(transport.mtu) }
}

interface IfaceFacts { cidr: string | null; mtu: number | null }

function describeIface(existing: any, cidrKey: 'cidr' | 'cidr6'): IfaceFacts {
  const cidr = String(existing?.[cidrKey] ?? '').trim()
  return { cidr: cidr || null, mtu: existing?.mtu ? Number(existing.mtu) : null }
}

function ifaceMatches(have: IfaceFacts, wantCidr: string, wantMtu: number | null): boolean {
  return have.cidr === wantCidr && (wantMtu === null || have.mtu === wantMtu)
}

function factsText(cidr: string | null, mtu: number | null): string {
  return `${cidr ?? '?'}${mtu ? `, MTU ${mtu}` : ''}`
}

export type TransportNodeState = 'provisioned' | 'missing' | 'drift' | 'unreachable'

export interface TransportNodeStatus {
  node: string
  iface: string
  state: TransportNodeState
  /** Address and MTU the transport asks for, as text. */
  wanted: string
  /** What the node carries on that interface, null when absent. */
  found: string | null
  message?: string
}

/**
 * Read-only view of the transport interfaces: what each listed node carries
 * against what the stored transport asks for. Same comparison as the
 * provisioning, nothing written. Empty outside transport mode.
 */
export async function getVdcTransportStatus(id: string): Promise<TransportNodeStatus[]> {
  const { transport, conn } = await loadVdcForTransport(id)
  if (transport.mode !== 'transport') return []
  const { iface, cidrKey, prefix, mtu } = transportTarget(transport)

  return Promise.all(Object.entries(transport.nodeAddresses).map(async ([node, ip]) => {
    const wantCidr = `${ip}/${prefix}`
    const wanted = factsText(wantCidr, mtu)
    try {
      const ifaces = (await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/network`)) || []
      const existing = ifaces.find((i: any) => i?.iface === iface)
      if (!existing) return { node, iface, state: 'missing' as const, wanted, found: null }
      const have = describeIface(existing, cidrKey)
      const found = factsText(have.cidr, have.mtu)
      return { node, iface, state: ifaceMatches(have, wantCidr, mtu) ? 'provisioned' as const : 'drift' as const, wanted, found }
    } catch (err: any) {
      return { node, iface, state: 'unreachable' as const, wanted, found: null, message: err?.message || String(err) }
    }
  }))
}

export type ProvisionAction = 'created' | 'updated' | 'unchanged' | 'error'

export interface ProvisionResult {
  node: string
  iface: string
  action: ProvisionAction
  message?: string
}

/**
 * Create or update the transport VLAN interface on every node listed in
 * the transport definition, then reload that node's network. Idempotent:
 * an interface already carrying the wanted address and MTU is left alone.
 * One node failing does not stop the others; each gets its own result.
 */
export async function provisionVdcTransport(id: string): Promise<ProvisionResult[]> {
  const { row, transport, conn } = await loadVdcForTransport(id)
  const { iface, cidrKey, prefix, mtu } = transportTarget(transport)
  const comment = `ProxCenter vDC ${row.slug}: VXLAN transport`
  const results: ProvisionResult[] = []

  for (const [node, ip] of Object.entries(transport.nodeAddresses)) {
    const nodePath = `/nodes/${encodeURIComponent(node)}/network`
    const wantCidr = `${ip}/${prefix}`
    try {
      const ifaces = (await pveFetch<any[]>(conn, nodePath)) || []
      const existing = ifaces.find((i: any) => i?.iface === iface)

      const body = new URLSearchParams()
      body.append('type', 'vlan')
      body.append(cidrKey, wantCidr)
      body.append('autostart', '1')
      body.append('comments', comment)
      if (mtu) body.append('mtu', String(mtu))

      if (!existing) {
        body.append('iface', iface)
        await pveFetch(conn, nodePath, { method: 'POST', body })
        await pveFetch(conn, nodePath, { method: 'PUT' })
        results.push({ node, iface, action: 'created' })
        continue
      }

      if (ifaceMatches(describeIface(existing, cidrKey), wantCidr, mtu)) {
        results.push({ node, iface, action: 'unchanged' })
        continue
      }

      await pveFetch(conn, `${nodePath}/${encodeURIComponent(iface)}`, { method: 'PUT', body })
      await pveFetch(conn, nodePath, { method: 'PUT' })
      results.push({ node, iface, action: 'updated' })
    } catch (err: any) {
      results.push({ node, iface, action: 'error', message: err?.message || String(err) })
    }
  }

  // A VXLAN interface picks its local tunnel address among the zone peers
  // when the SDN config is rendered. Before the segment existed on a node,
  // PVE fell back to the route source address, so the zone has to be
  // re-rendered once the interfaces are in place.
  if (results.some(r => r.action === 'created' || r.action === 'updated')) {
    try {
      await applySdn(conn)
    } catch (err: any) {
      console.warn(`[vdc] applySdn failed after provisioning the transport of vDC ${row.slug}: ${err?.message}`)
    }
  }

  return results
}
