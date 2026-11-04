import { describe, expect, it } from 'vitest'

import type { MicrosegDrift } from '@/lib/microseg/types'

import { groupDrifts, kindCounts } from './driftsModel'

const d = (kind: string, vmid = 1): MicrosegDrift => ({ kind, guest: { node: 'pve1', type: 'qemu', vmid } })
const DRIFTS = [d('object_collision'), d('unzoned_running', 1), d('brand_new'), d('unzoned_running', 2), d('nic_firewall_off'), d('a_new_one')]

describe('drift groups', () => {
  it('groups by kind in the documented order, the unknown kinds after by name, none empty', () => {
    expect(groupDrifts(DRIFTS).map(g => [g.kind, g.drifts.length])).toEqual([
      ['unzoned_running', 2], ['nic_firewall_off', 1], ['object_collision', 1], ['a_new_one', 1], ['brand_new', 1],
    ])
  })

  it('keeps one kind when asked', () => {
    expect(groupDrifts(DRIFTS, 'unzoned_running').map(g => g.kind)).toEqual(['unzoned_running'])
    expect(groupDrifts(DRIFTS, 'gone')).toEqual([])
  })

  it('counts each kind in the same order', () => {
    expect(kindCounts(DRIFTS)).toEqual([
      { kind: 'unzoned_running', count: 2 }, { kind: 'nic_firewall_off', count: 1 }, { kind: 'object_collision', count: 1 },
      { kind: 'a_new_one', count: 1 }, { kind: 'brand_new', count: 1 },
    ])
  })
})
