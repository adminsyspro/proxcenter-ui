import { describe, expect, it } from 'vitest'

import type { MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { assignRows, chosenByCluster, membersBody } from './assignModel'
import type { PolicyGuest } from './zoneModel'

const zone = (id: string, name: string) => ({ id, name } as MicrosegZone)
const DB = zone('zd', 'db')
const WEB = zone('zw', 'web')
const ct = (connectionId: string, name: string, tags: string[] = []): PolicyGuest =>
  ({ connectionId, vmid: 100, name, node: 'pve1', type: 'lxc', status: 'running', tags })
const pending = (connection_id: string, zone_id: string): PendingMember =>
  ({ id: `p-${connection_id}`, policy_id: 'p1', connection_id, node: 'pve1', type: 'lxc', vmid: 100, zone_id })

describe('assignRows on a shared policy', () => {
  const guests = [ct('conn-1', 'ct-a'), ct('conn-2', 'ct-b')]

  it('gives two guests with the same type and VMID on two clusters two rows with distinct keys', () => {
    const rows = assignRows(DB, [DB, WEB], 'zone-', guests, [])
    expect(rows.map(r => r.key)).toEqual(['conn-1/lxc/100', 'conn-2/lxc/100'])
    expect(rows.map(r => r.member)).toEqual([null, null])
  })

  it('marks only the guest of the cluster a pending member belongs to', () => {
    const rows = assignRows(DB, [DB, WEB], 'zone-', guests, [pending('conn-2', 'zd')])
    expect(rows.map(r => [r.key, r.member])).toEqual([['conn-1/lxc/100', null], ['conn-2/lxc/100', 'pending']])
  })

  it('says a guest moves only when its own cluster queued it elsewhere', () => {
    const rows = assignRows(DB, [DB, WEB], 'zone-', guests, [pending('conn-1', 'zw')])
    expect(rows.map(r => r.otherZones)).toEqual([['web'], []])
  })
})

describe('chosenByCluster', () => {
  it('groups the selection by cluster, one request each, in a stable order', () => {
    const rows = assignRows(DB, [DB], 'zone-', [ct('conn-2', 'ct-b'), ct('conn-1', 'ct-a'), { ...ct('conn-2', 'ct-c'), vmid: 101 }], [])
    const groups = chosenByCluster(rows)
    expect(groups.map(([id, list]) => [id, list.map(r => r.guest.name)])).toEqual([['conn-1', ['ct-a']], ['conn-2', ['ct-b', 'ct-c']]])
  })

  it('makes one group for a single cluster, with the body sent today', () => {
    const rows = assignRows(DB, [DB], 'zone-', [ct('conn-1', 'ct-a')], [])
    const groups = chosenByCluster(rows)
    expect(groups).toHaveLength(1)
    expect(membersBody(3, 'zd', groups[0][1])).toEqual({ version: 3, zone_id: 'zd', guests: [{ node: 'pve1', type: 'lxc', vmid: 100 }] })
  })
})
