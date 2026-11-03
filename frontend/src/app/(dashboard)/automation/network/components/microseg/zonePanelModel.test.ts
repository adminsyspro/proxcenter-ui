import { describe, expect, it } from 'vitest'

import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import type { ZoneMember } from './zoneModel'
import { zonePosture, zoneSuggestions } from './zonePanelModel'
import { suggestion } from './policyTestKit'

const zone = (id: string, name: string) => ({ id, name } as MicrosegZone)
const ZONES = [zone('zd', 'db'), zone('zw', 'web')]
const member = (vmid: number, status: string | null): ZoneMember => ({
  ref: { node: 'pve1', type: 'qemu', vmid },
  guest: status === null ? null : { vmid, name: `vm${vmid}`, node: 'pve1', type: 'qemu', status, tags: [] },
  pending: false,
})

describe('zonePosture', () => {
  const members = [member(1, 'running'), member(2, 'running'), member(3, 'stopped'), member(4, null)]
  const drifts: MicrosegDrift[] = [
    { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 1 } },
    { kind: 'nic_firewall_off', guest: { node: 'pve2', type: 'qemu', vmid: 1 } },
    { kind: 'member_without_ip', guest: { node: 'pve1', type: 'qemu', vmid: 3 } },
    { kind: 'ipset_out_of_sync', object: 'pcz-db', detail: { zone: 'zd' } },
    { kind: 'ipset_out_of_sync', object: 'pcz-web', detail: { zone: 'zw' } },
    { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 99 } },
  ]

  it('counts members by status, members with the NIC firewall off once each, and the drifts of the zone or its members', () => {
    expect(zonePosture(ZONES[0], members, drifts, ZONES)).toEqual({ running: 2, stopped: 1, firewallOff: 1, drifts: 4, driftsKnown: true })
  })

  it('says the drifts are not known before the engine computed them', () => {
    expect(zonePosture(ZONES[0], members, null, ZONES)).toMatchObject({ drifts: 0, driftsKnown: false, firewallOff: 0 })
  })
})

describe('zoneSuggestions', () => {
  it('keeps the pending learned flows towards the zone, the busiest first', () => {
    const list = [
      { ...suggestion('2026-11-03T10:00:00Z'), id: 'a', dst_zone_id: 'zd', hits: 2 },
      { ...suggestion('2026-11-03T10:00:00Z'), id: 'b', dst_zone_id: 'zd', hits: 9 },
      { ...suggestion('2026-11-03T10:00:00Z'), id: 'c', dst_zone_id: 'zw', hits: 50 },
      { ...suggestion('2026-11-03T10:00:00Z'), id: 'd', dst_zone_id: 'zd', hits: 99, status: 'dismissed' as const },
    ]
    expect(zoneSuggestions(list, 'zd').map(s => s.id)).toEqual(['b', 'a'])
  })
})
