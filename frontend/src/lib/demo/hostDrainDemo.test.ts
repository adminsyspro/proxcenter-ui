/**
 * The demo drain plan (roadmap#198): built from the demo inventory, never
 * targets a drained node, keeps stopped guests unless asked, and in a group
 * refuses the plan when a guest fits nowhere.
 */
import { describe, expect, it } from 'vitest'

import { demoDrainPlan } from './hostDrainDemo'

const GiB = 1024 ** 3
const NODES = [
  { node: 'n1', status: 'online', mem: 10 * GiB, maxmem: 100 * GiB, cpu: 0.1, maxcpu: 16 },
  { node: 'n2', status: 'online', mem: 20 * GiB, maxmem: 100 * GiB, cpu: 0.2, maxcpu: 16 },
  { node: 'n3', status: 'online', mem: 50 * GiB, maxmem: 100 * GiB, cpu: 0.3, maxcpu: 16 },
  { node: 'n4', status: 'offline', mem: 0, maxmem: 100 * GiB },
]
const GUESTS = [
  { vmid: 100, name: 'web', type: 'qemu', node: 'n1', status: 'running', maxmem: 8 * GiB, cpu: 0.5, maxcpu: 4 },
  { vmid: 101, name: 'ct', type: 'lxc', node: 'n1', status: 'running', maxmem: 2 * GiB },
  { vmid: 102, name: 'off', type: 'qemu', node: 'n1', status: 'stopped', maxmem: 4 * GiB },
  { vmid: 103, name: 'tpl', type: 'qemu', node: 'n1', status: 'stopped', template: true },
  { vmid: 200, name: 'db', type: 'qemu', node: 'n2', status: 'running', maxmem: 16 * GiB },
]

describe('demoDrainPlan', () => {
  it('drains one node to the roomiest online node, keeps stopped guests, skips templates', () => {
    const plan = demoDrainPlan({ node: 'n1', config: { mem_ceiling_percent: 90 } }, NODES, GUESTS)

    expect(plan.node).toBe('n1')
    expect(plan.candidates).toEqual(['n2', 'n3'])
    expect(plan.guests.map(g => [g.vmid, g.status, g.mode, g.target_node ?? null])).toEqual([
      [100, 'pending', 'online', 'n2'],
      [101, 'pending', 'restart', 'n2'],
      [102, 'skipped', 'offline', null],
    ])
    expect(plan).toMatchObject({ movable: 2, skipped: 1 })
    expect(plan.blocked).toBeUndefined()
    const n2 = plan.projection.find(p => p.node === 'n2')!
    expect(n2).toMatchObject({ mem_before: 20 * GiB, mem_after: 30 * GiB, guests_in: 2, source: false })
    expect(n2.cpu_after).toBeCloseTo(0.2 + 2 / 16)
    expect(plan.projection.find(p => p.node === 'n1')).toMatchObject({ source: true, mem_after: 0, guests_out: 2 })
  })

  it('moves stopped guests when asked, honours a chosen target and a guest kept on the node', () => {
    const plan = demoDrainPlan({ node: 'n1', config: { include_stopped: true, guest_targets: { 100: 'n3' }, keep_vmids: [101] } }, NODES, GUESTS)

    expect(plan.guests.map(g => [g.vmid, g.status, g.target_node ?? null])).toEqual([[100, 'pending', 'n3'], [101, 'skipped', null], [102, 'pending', 'n2']])
  })

  it('never targets a node of the group, and blocks the group when a guest fits nowhere', () => {
    const ok = demoDrainPlan({ config: { nodes: ['n1', 'n2'], mem_ceiling_percent: 90 } }, NODES, GUESTS)
    expect(ok.node).toBe('n1,n2')
    expect(ok.candidates).toEqual(['n3'])
    expect(ok.guests.filter(g => g.status === 'pending').every(g => g.target_node === 'n3')).toBe(true)
    expect(ok.blocked).toEqual([])

    const full = demoDrainPlan({ config: { nodes: ['n1', 'n2'], mem_ceiling_percent: 70 } }, NODES, GUESTS)
    expect(full.blocked).toEqual(['VM 200 (db): not enough memory left on the nodes that may receive it'])
    expect(full.guests.find(g => g.vmid === 200)).toMatchObject({ status: 'skipped', reason: expect.stringContaining('not enough memory') })
  })

  it('migrates a selection off each guest own node', () => {
    const plan = demoDrainPlan({ config: { vmids: [100, 200], include_stopped: true } }, NODES, GUESTS)

    expect(plan.node).toBe('')
    expect(plan.candidates).toEqual(['n1', 'n2', 'n3'])
    expect(plan.guests.map(g => [g.vmid, g.source_node, g.target_node])).toEqual([[100, 'n1', 'n2'], [200, 'n2', 'n1']])
  })

  it('answers an empty plan to a request it cannot read', () => {
    expect(demoDrainPlan(null, [], [])).toMatchObject({ node: '', guests: [], candidates: [], projection: [], movable: 0, skipped: 0 })
  })
})
