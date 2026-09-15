// src/lib/vdc/stretchPeers.ts
// The peers a vDC's zone carries because of the stretched tenant networks it
// is a member of (#901): the transport endpoints of every other member vDC.
// Kept apart from the membership orchestration so the zone status, the zone
// sync and updateVdc can all call it without importing each other.

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'

import { listClusterNodeIps } from './sdn'
import { resolveZonePeers, transportFromRow, type ZoneConfig } from './transport'

/** The vDC columns the peer computation needs. */
export const VDC_TRANSPORT_SELECT = {
  id: true,
  name: true,
  connectionId: true,
  sdnZoneName: true,
  vxlanTransportMode: true,
  vxlanPeers: true,
  vxlanMtu: true,
  transportVlanId: true,
  transportDevice: true,
  transportCidr: true,
  transportNodeAddresses: true,
} as const

export interface VdcTransportRow {
  id: string
  name: string
  connectionId: string
  sdnZoneName: string | null
  vxlanTransportMode: string | null
  vxlanPeers: string[] | null
  vxlanMtu: number | null
  transportVlanId: number | null
  transportDevice: string | null
  transportCidr: string | null
  transportNodeAddresses: unknown
}

export async function connectionOf(connectionId: string): Promise<any> {
  const meta = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!meta) throw new Error(`Connection not found: ${connectionId}`)
  return getConnectionById(connectionId, meta.tenantId)
}

/**
 * The peers a vDC's own zone asks for, from its transport (#899). Only the
 * `cluster` mode needs the node addresses, read from that vDC's cluster.
 */
export async function zoneConfigOfVdc(vdc: VdcTransportRow, conn?: any): Promise<ZoneConfig> {
  const transport = transportFromRow(vdc)
  let clusterIps: string[] = []
  if (transport.mode === 'cluster') {
    try {
      clusterIps = await listClusterNodeIps(conn ?? await connectionOf(vdc.connectionId))
    } catch (err: any) {
      throw new Error(`Tenant network: cannot read the node addresses of the cluster of vDC "${vdc.name}": ${err?.message}`)
    }
  }
  return { peers: resolveZonePeers(transport, clusterIps), mtu: transport.mtu ?? null }
}

/**
 * The peers of every other vDC that shares a tenant network with this one,
 * over all the networks it carries. Empty when it carries none, which is
 * every vDC before #901, so the zone paths pay nothing then.
 */
export async function memberPeersForVdc(vdcId: string): Promise<string[]> {
  const memberships = await prisma.tenantNetworkMember.findMany({
    where: { vdcId },
    select: { tenantNetworkId: true },
  })
  if (memberships.length === 0) return []

  const others = await prisma.tenantNetworkMember.findMany({
    where: { tenantNetworkId: { in: memberships.map(m => m.tenantNetworkId) }, vdcId: { not: vdcId } },
    select: { vdc: { select: VDC_TRANSPORT_SELECT } },
    distinct: ['vdcId'],
  })

  const peers = new Set<string>()
  for (const other of others) {
    for (const p of (await zoneConfigOfVdc(other.vdc)).peers) peers.add(p)
  }
  return [...peers]
}

/** A zone config with the other members' peers added, order preserved, no duplicate. */
export function withMemberPeers(zone: ZoneConfig, memberPeers: string[]): ZoneConfig {
  if (memberPeers.length === 0) return zone
  return { peers: [...new Set([...zone.peers, ...memberPeers])], mtu: zone.mtu }
}
