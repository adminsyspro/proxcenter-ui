// src/lib/vdc/evpnVdc.ts
// Attachment of a vDC to a shared EVPN zone (#1334). The zone must run on
// the vDC's cluster; once attached, the tenant creates networks in the zone
// that reach its other vDCs attached to it. Kept apart from evpnZones.ts so
// createVdc / updateVdc can call it without importing the zone orchestration.

import { prisma } from '@/lib/db/prisma'

const ERR = 'EVPN zone:'

export interface AttachedEvpnZone {
  id: string
  name: string
  zoneName: string
  mtu: number | null
  vniStart: number
  vniEnd: number
}

/** The zone a vDC of `connectionId` asks to join; refused when the cluster does not carry it. */
export async function assertEvpnZoneForCluster(evpnZoneId: string, connectionId: string): Promise<AttachedEvpnZone> {
  const zone = await prisma.sdnEvpnZone.findUnique({
    where: { id: evpnZoneId },
    select: { id: true, name: true, zoneName: true, mtu: true, vniStart: true, vniEnd: true, members: { select: { connectionId: true } } },
  })
  if (!zone) throw new Error(`${ERR} not found.`)
  if (!zone.members.some(m => m.connectionId === connectionId)) {
    throw new Error(`${ERR} "${zone.name}" is not carried by the cluster of this vDC. Add the cluster to the zone first.`)
  }
  const { members: _members, ...rest } = zone
  return rest
}

/** A vDC cannot leave its zone while it still carries networks of it. */
export async function assertEvpnDetachSafe(vdcId: string): Promise<void> {
  const carried = await prisma.tenantNetworkMember.count({
    where: { vdcId, tenantNetwork: { evpnZoneId: { not: null } } },
  })
  if (carried > 0) {
    throw new Error(`${ERR} this vDC still carries ${carried} network(s) of the zone. Remove them from the vDC first.`)
  }
}

/** vDCs attached to a zone on one cluster: they block detaching that cluster. */
export async function attachedVdcCount(evpnZoneId: string, connectionId?: string): Promise<number> {
  return prisma.vdc.count({ where: { evpnZoneId, ...(connectionId ? { connectionId } : {}) } })
}
