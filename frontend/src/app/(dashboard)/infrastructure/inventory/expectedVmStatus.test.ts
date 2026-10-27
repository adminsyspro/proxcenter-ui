import { describe, expect, it } from 'vitest'

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import { EXPECTED_STATUS_HOLD_MS, expectStatus, holdExpectedStatuses, withVmStatus, type ExpectedStatuses } from './expectedVmStatus'
import type { TreeCluster } from './InventoryTree'

const update = (vmid: number, status: string, cpu = 0.2): InventoryEvent =>
  ({ event: 'vm:update', connId: 'c1', vmid, node: 'pve1', type: 'qemu', status, cpu })

describe('holdExpectedStatuses', () => {
  it('keeps the status a stop leads to over a cycle that still read the guest running', () => {
    const expected: ExpectedStatuses = new Map()
    expectStatus(expected, 'c1', '9882', 'stopped', 1000)

    const events = holdExpectedStatuses([update(9882, 'running', 0.4), update(100, 'running')], expected, 5000)

    expect(events).toEqual([update(9882, 'stopped', 0.4), update(100, 'running')])
    expect(expected.size).toBe(1)
  })

  it('lets the stream through again once Proxmox reports the expected status', () => {
    const expected: ExpectedStatuses = new Map()
    expectStatus(expected, 'c1', 9882, 'stopped', 1000)

    expect(holdExpectedStatuses([update(9882, 'stopped')], expected, 9000)).toEqual([update(9882, 'stopped')])
    expect(expected.size).toBe(0)
    expect(holdExpectedStatuses([update(9882, 'running')], expected, 9500)).toEqual([update(9882, 'running')])
  })

  it('gives up the hold after a while, so a failed action shows the real status', () => {
    const expected: ExpectedStatuses = new Map()
    expectStatus(expected, 'c1', 9882, 'running', 1000)

    const late = 1000 + EXPECTED_STATUS_HOLD_MS + 1
    expect(holdExpectedStatuses([update(9882, 'stopped')], expected, late)).toEqual([update(9882, 'stopped')])
    expect(expected.size).toBe(0)
  })

  it('leaves other events and other connections alone', () => {
    const expected: ExpectedStatuses = new Map()
    expectStatus(expected, 'c1', 9882, 'stopped', 1000)
    const others: InventoryEvent[] = [
      { event: 'node:update', connId: 'c1', node: 'pve1', status: 'online' },
      { ...update(9882, 'running'), connId: 'c2' } as InventoryEvent,
    ]

    expect(holdExpectedStatuses(others, expected, 2000)).toEqual(others)
  })

  it('returns the same array when nothing is expected', () => {
    const events = [update(9882, 'running')]
    expect(holdExpectedStatuses(events, new Map())).toBe(events)
  })
})

describe('withVmStatus', () => {
  const vm = (vmid: string, type = 'qemu', status = 'running') => ({ vmid, type, name: `vm${vmid}`, status })
  const node = (name: string, vms: any[]) => ({ node: name, status: 'online', vms }) as any
  const tree = (): TreeCluster[] => [
    { connId: 'c1', name: 'c1', isCluster: true, pools: [], nodes: [node('pve1', [vm('100'), vm('101', 'lxc')]), node('pve2', [vm('200')])] },
    { connId: 'c2', name: 'c2', isCluster: false, pools: [], nodes: [node('pve9', [vm('100')])] },
  ]

  it('sets the guest status and keeps every untouched branch', () => {
    const before = tree()
    const after = withVmStatus(before, 'c1', 100, 'stopped')

    expect(after[0].nodes[0].vms[0].status).toBe('stopped')
    expect(after[0].nodes[0].vms[1]).toBe(before[0].nodes[0].vms[1])
    expect(after[0].nodes[1]).toBe(before[0].nodes[1])
    expect(after[1]).toBe(before[1])
  })

  it('matches the guest type when the caller gives it', () => {
    const before = tree()

    expect(withVmStatus(before, 'c1', '101', 'stopped', 'qemu')[0]).toBe(before[0])
    expect(withVmStatus(before, 'c1', '101', 'stopped', 'lxc')[0].nodes[0].vms[1].status).toBe('stopped')
  })
})
