// src/lib/vdc/evpnReservations.ts
// The VNI space the declared EVPN zones hold (#1334): the range their VNets
// are taken from and the VNI of their VRF. Both are off limits to the VXLAN
// networks of every cluster. Kept apart from evpnZones.ts so the VNI
// allocators can read it without importing the zone orchestration.

import { prisma } from '@/lib/db/prisma'

export interface EvpnReservation {
  ranges: Array<{ start: number; end: number; zoneName: string }>
  vrfVnis: Array<{ vni: number; zoneName: string }>
}

export async function evpnReservations(): Promise<EvpnReservation> {
  const zones = await prisma.sdnEvpnZone.findMany({
    select: { zoneName: true, vrfVxlan: true, vniStart: true, vniEnd: true },
  })
  return {
    ranges: zones.map(z => ({ start: z.vniStart, end: z.vniEnd, zoneName: z.zoneName })),
    vrfVnis: zones.map(z => ({ vni: z.vrfVxlan, zoneName: z.zoneName })),
  }
}

export function inEvpnRange(vni: number, reservation: EvpnReservation): boolean {
  return reservation.ranges.some(r => vni >= r.start && vni <= r.end)
}
