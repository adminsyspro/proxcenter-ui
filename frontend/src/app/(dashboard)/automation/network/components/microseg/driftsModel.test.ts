import { describe, expect, it } from 'vitest'

import type { MicrosegDrift } from '@/lib/microseg/types'

import { driftKey } from './driftLabels'
import { driftRowKey, groupDrifts, kindCounts, mergeDrifts } from './driftsModel'

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

describe('IP filter drifts in the groups', () => {
  it('come after the outbound kinds, in the order the sub-tab documents them, before the kinds it does not know', () => {
    const list = [d('zz_unknown'), d('unzoned_same_network'), d('ipfilter_manual'), d('ipfilter_address_held'), d('ipfilter_address_held', 2), d('ipfilter_off'), d('egress_no_subnet'), d('ipfilter_no_address'), d('ipfilter_list_changed')]
    expect(groupDrifts(list).map(g => [g.kind, g.drifts.length])).toEqual([
      ['egress_no_subnet', 1], ['ipfilter_off', 1], ['ipfilter_list_changed', 1], ['ipfilter_no_address', 1], ['ipfilter_address_held', 2], ['ipfilter_manual', 1],
      ['unzoned_same_network', 1], ['zz_unknown', 1],
    ])
    expect(kindCounts(list).find(c => c.kind === 'ipfilter_address_held')).toEqual({ kind: 'ipfilter_address_held', count: 2 })
  })

  it('gives two addresses held on one guest two row keys, on one cluster and on a shared policy', () => {
    const held = (addr: string) => ({ kind: 'ipfilter_address_held', guest: { node: 'pve1', type: 'qemu' as const, vmid: 1 }, detail: { nic: 'net0', addr }, connection_id: 'c1' })
    expect(driftRowKey(held('10.0.0.7'), false)).not.toBe(driftRowKey(held('10.0.0.8'), false))
    expect(driftRowKey(held('10.0.0.7'), true)).toBe('c1|ipfilter_address_held|qemu/1|||net0|10.0.0.7')
  })
})

describe('drifts of a shared policy', () => {
  it('keeps both rows when two clusters report the same guest VMID, each with its cluster', () => {
    const merged = mergeDrifts({ c1: { drifts: [d('unzoned_running', 100)], computed: true }, c2: { drifts: [d('unzoned_running', 100)], computed: true } }, ['c1', 'c2'])
    expect(merged.drifts.map(x => [x.connection_id, x.guest?.vmid])).toEqual([['c1', 100], ['c2', 100]])
    expect(new Set(merged.drifts.map(x => driftRowKey(x, true))).size).toBe(2)
    expect(groupDrifts(merged.drifts)[0].drifts).toHaveLength(2)
  })

  it('keys a row as today on a policy of one cluster, so what was ignored stays ignored', () => {
    const merged = mergeDrifts({ c1: { drifts: [d('unzoned_running', 100)], computed: true } }, ['c1'])
    expect(driftRowKey(merged.drifts[0], false)).toBe(driftKey(d('unzoned_running', 100)))
  })

  it('says the list is computed once one cluster that answered computed it, and leaves out the clusters that did not answer', () => {
    const merged = mergeDrifts({ c1: { drifts: [], computed: false }, c2: undefined }, ['c1', 'c2'])
    expect(merged).toMatchObject({ drifts: [], computed: false, answered: true })
    expect(mergeDrifts({ c1: undefined }, ['c1']).answered).toBe(false)
    expect(mergeDrifts({ c1: { drifts: [], computed: false }, c2: { drifts: [], computed: true } }, ['c1', 'c2']).computed).toBe(true)
  })
})
