import { describe, expect, it } from 'vitest'

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import { applyInventoryEvents } from './applyInventoryEvents'
import type { TreeCluster } from './InventoryTree'

type Node = TreeCluster['nodes'][number]
type Guest = Node['vms'][number]

const guest = (vmid: number | string, over: Partial<Guest> = {}): Guest => ({
  type: 'qemu',
  vmid: String(vmid),
  name: `vm${vmid}`,
  status: 'running',
  cpu: 0.1,
  mem: 100,
  maxmem: 1000,
  disk: 5,
  maxdisk: 50,
  ...over,
})

const node = (name: string, vms: Guest[], over: Partial<Node> = {}): Node => ({
  node: name,
  status: 'online',
  cpu: 0.2,
  mem: 10,
  maxmem: 100,
  vms,
  ...over,
})

const cluster = (connId: string, nodes: Node[]): TreeCluster => ({
  connId,
  name: connId,
  isCluster: nodes.length > 1,
  pools: [],
  nodes,
})

const vmUpdate = (over: Partial<Extract<InventoryEvent, { event: 'vm:update' }>>): InventoryEvent => ({
  event: 'vm:update', connId: 'c1', vmid: 100, node: 'n1', type: 'qemu', status: 'running', ...over,
})

const vmAdded = (over: Partial<Extract<InventoryEvent, { event: 'vm:added' }>>): InventoryEvent => ({
  event: 'vm:added', connId: 'c1', vmid: 300, node: 'n1', type: 'qemu', status: 'running', ...over,
})

const vmRemoved = (over: Partial<Extract<InventoryEvent, { event: 'vm:removed' }>>): InventoryEvent => ({
  event: 'vm:removed', connId: 'c1', vmid: 100, node: 'n1', type: 'qemu', ...over,
})

const nodeUpdate = (over: Partial<Extract<InventoryEvent, { event: 'node:update' }>>): InventoryEvent => ({
  event: 'node:update', connId: 'c1', node: 'n1', status: 'online', ...over,
})

function twoClusters(): TreeCluster[] {
  return [
    cluster('c1', [
      node('n1', [guest(100), guest(101, { type: 'lxc' })]),
      node('n2', [guest(200)]),
    ]),
    cluster('c2', [node('m1', [guest(100)])]),
  ]
}

const vmids = (n: Node) => n.vms.map(vm => vm.vmid)

describe('applyInventoryEvents: batches that change nothing', () => {
  it('returns the same reference for an empty batch', () => {
    const prev = twoClusters()
    expect(applyInventoryEvents(prev, [])).toBe(prev)
  })

  it('returns the same reference when no cluster matches the events', () => {
    const prev = twoClusters()
    expect(applyInventoryEvents(prev, [vmUpdate({ connId: 'nope', status: 'stopped' })])).toBe(prev)
    expect(applyInventoryEvents([], [vmUpdate({ status: 'stopped' })])).toEqual([])
  })

  it('ignores malformed entries and unknown event kinds', () => {
    const prev = twoClusters()
    const junk = [null, {}, { event: 'vm:update' }, { event: 'storage:update', connId: 'c1' }] as unknown as InventoryEvent[]
    expect(applyInventoryEvents(prev, junk)).toBe(prev)
  })

  it('returns the same reference when every value already matches', () => {
    const prev = twoClusters()
    const same = applyInventoryEvents(prev, [
      vmUpdate({ vmid: 100, status: 'running', cpu: 0.1 }),
      nodeUpdate({ node: 'n1', status: 'online', cpu: 0.2 }),
      vmRemoved({ vmid: 999 }),
      vmAdded({ vmid: 100 }),
    ])
    expect(same).toBe(prev)
  })
})

describe('applyInventoryEvents: vm:update', () => {
  it('merges the delta into the guest and leaves absent fields alone', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [vmUpdate({ vmid: 100, status: 'stopped', cpu: 0, name: 'renamed' })])

    const vm = next[0].nodes[0].vms[0]
    expect(vm).toEqual({ ...guest(100), status: 'stopped', cpu: 0, name: 'renamed' })
    // mem/maxmem/disk/maxdisk were not in the delta: the previous values stay.
    expect(vm.mem).toBe(100)
    expect(vm.maxdisk).toBe(50)
  })

  it('sets the status even when the delta carries nothing else', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [vmUpdate({ vmid: 100, status: 'paused' })])
    expect(next[0].nodes[0].vms[0].status).toBe('paused')
  })

  it('creates new objects only along the changed path', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [vmUpdate({ vmid: 100, status: 'stopped' })])

    expect(next).not.toBe(prev)
    expect(next[0]).not.toBe(prev[0])
    expect(next[0].nodes[0]).not.toBe(prev[0].nodes[0])
    expect(next[0].nodes[0].vms[0]).not.toBe(prev[0].nodes[0].vms[0])
    // Sibling guest, sibling node and the other cluster are untouched.
    expect(next[0].nodes[0].vms[1]).toBe(prev[0].nodes[0].vms[1])
    expect(next[0].nodes[1]).toBe(prev[0].nodes[1])
    expect(next[1]).toBe(prev[1])
  })

  it('matches the guest by vmid and type, wherever it sits, regardless of the event node', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [
      // Event says n1, the guest lives on n2: still updated.
      vmUpdate({ vmid: '200', node: 'n1', status: 'stopped' }),
      // Same vmid as the qemu guest but another type: no such lxc guest.
      vmUpdate({ vmid: 100, type: 'lxc', node: 'n1', status: 'stopped' }),
    ])
    expect(next[0].nodes[1].vms[0].status).toBe('stopped')
    expect(next[0].nodes[0]).toBe(prev[0].nodes[0])
  })

  it('applies several updates of the same guest in order, each keeping what the next omits', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [
      vmUpdate({ vmid: 100, status: 'running', cpu: 0.9 }),
      vmUpdate({ vmid: 100, status: 'stopped' }),
    ])
    expect(next[0].nodes[0].vms[0]).toMatchObject({ status: 'stopped', cpu: 0.9 })
  })
})

describe('applyInventoryEvents: node:update', () => {
  it('merges status, cpu, mem and maxmem with fallbacks on the previous values', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [nodeUpdate({ node: 'n1', status: 'offline', cpu: 0.5 })])

    const n = next[0].nodes[0]
    expect(n).toMatchObject({ status: 'offline', cpu: 0.5, mem: 10, maxmem: 100 })
    // The guest list is the same array: nothing in it changed.
    expect(n.vms).toBe(prev[0].nodes[0].vms)
    expect(next[0].nodes[1]).toBe(prev[0].nodes[1])
    expect(next[1]).toBe(prev[1])
  })

  it('keeps the previous status when the delta has none', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [nodeUpdate({ node: 'n1', status: undefined, mem: 42 })])
    expect(next[0].nodes[0]).toMatchObject({ status: 'online', mem: 42 })
  })

  it('ignores a node the cluster does not have', () => {
    const prev = twoClusters()
    expect(applyInventoryEvents(prev, [nodeUpdate({ node: 'ghost', status: 'offline' })])).toBe(prev)
  })
})

describe('applyInventoryEvents: vm:added', () => {
  it('appends the guest to the named node with the tree defaults, in vmid order', () => {
    const prev = [cluster('c1', [node('n1', [guest(100), guest(2000)])])]
    const next = applyInventoryEvents(prev, [vmAdded({ vmid: 300, name: undefined, status: undefined, cpu: 0.3 })])

    // Numeric order, not lexicographic: 300 sits before 2000.
    expect(vmids(next[0].nodes[0])).toEqual(['100', '300', '2000'])
    expect(next[0].nodes[0].vms[1]).toEqual({
      type: 'qemu',
      vmid: '300',
      name: 'qemu/300',
      status: 'unknown',
      cpu: 0.3,
      mem: undefined,
      maxmem: undefined,
      pool: null,
      tags: null,
      template: false,
    })
    // The existing guests are the same objects.
    expect(next[0].nodes[0].vms[0]).toBe(prev[0].nodes[0].vms[0])
    expect(next[0].nodes[0].vms[2]).toBe(prev[0].nodes[0].vms[1])
  })

  it('keeps the name and status the delta carries', () => {
    const prev = [cluster('c1', [node('n1', [])])]
    const next = applyInventoryEvents(prev, [vmAdded({ vmid: 7, type: 'lxc', name: 'ct7', status: 'stopped' })])
    expect(next[0].nodes[0].vms).toEqual([expect.objectContaining({ type: 'lxc', vmid: '7', name: 'ct7', status: 'stopped' })])
  })

  it('ignores a guest the node already holds, and a node the cluster does not have', () => {
    const prev = twoClusters()
    expect(applyInventoryEvents(prev, [vmAdded({ vmid: '100', node: 'n1' })])).toBe(prev)
    expect(applyInventoryEvents(prev, [vmAdded({ vmid: 300, node: 'ghost' })])).toBe(prev)
  })

  it('adds the same guest once when the batch repeats it', () => {
    const prev = [cluster('c1', [node('n1', [])])]
    const next = applyInventoryEvents(prev, [vmAdded({ vmid: 5 }), vmAdded({ vmid: 5 }), vmAdded({ vmid: 4 })])
    expect(vmids(next[0].nodes[0])).toEqual(['4', '5'])
  })
})

describe('applyInventoryEvents: vm:removed', () => {
  it('removes the guest from whichever node holds it, regardless of the event node', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [vmRemoved({ vmid: 200, node: 'n1' })])

    expect(vmids(next[0].nodes[1])).toEqual([])
    expect(next[0].nodes[0]).toBe(prev[0].nodes[0])
    expect(next[1]).toBe(prev[1])
  })

  it('matches on type too, and ignores a guest nobody holds', () => {
    const prev = twoClusters()
    expect(applyInventoryEvents(prev, [vmRemoved({ vmid: 101, type: 'qemu' })])).toBe(prev)
    const next = applyInventoryEvents(prev, [vmRemoved({ vmid: 101, type: 'lxc' })])
    expect(vmids(next[0].nodes[0])).toEqual(['100'])
  })
})

describe('applyInventoryEvents: one batch, several kinds', () => {
  it('relocates a guest with the remove+add pair of one batch, whatever their order', () => {
    for (const order of ['remove-first', 'add-first']) {
      const prev = twoClusters()
      const pair = [vmRemoved({ vmid: 100, node: 'n1' }), vmAdded({ vmid: 100, node: 'n2', name: 'vm100' })]
      const next = applyInventoryEvents(prev, order === 'remove-first' ? pair : [pair[1], pair[0]])

      expect(vmids(next[0].nodes[0])).toEqual(['101'])
      expect(vmids(next[0].nodes[1])).toEqual(['100', '200'])
    }
  })

  it('applies updates to the state left by the removals and additions', () => {
    const prev = [cluster('c1', [node('n1', [guest(100)])])]
    const next = applyInventoryEvents(prev, [
      vmUpdate({ vmid: 300, status: 'stopped', cpu: 0.7 }),
      vmAdded({ vmid: 300, status: 'running' }),
      vmRemoved({ vmid: 100 }),
    ])
    expect(next[0].nodes[0].vms).toEqual([expect.objectContaining({ vmid: '300', status: 'stopped', cpu: 0.7 })])
  })

  it('touches only the clusters that have deltas', () => {
    const prev = [...twoClusters(), cluster('c3', [node('z1', [guest(1)])])]
    const next = applyInventoryEvents(prev, [
      vmUpdate({ connId: 'c1', vmid: 100, status: 'stopped' }),
      nodeUpdate({ connId: 'c2', node: 'm1', status: 'offline' }),
      vmUpdate({ connId: 'c2', vmid: 100, status: 'stopped' }),
    ])

    expect(next[0].nodes[0].vms[0].status).toBe('stopped')
    expect(next[1].nodes[0]).toMatchObject({ status: 'offline' })
    expect(next[1].nodes[0].vms[0].status).toBe('stopped')
    expect(next[2]).toBe(prev[2])
  })

  it('combines node fields and guest changes on one node into a single new node object', () => {
    const prev = twoClusters()
    const next = applyInventoryEvents(prev, [
      nodeUpdate({ node: 'n1', cpu: 0.8 }),
      vmAdded({ vmid: 50, node: 'n1' }),
    ])
    const n = next[0].nodes[0]
    expect(n).not.toBe(prev[0].nodes[0])
    expect(n.cpu).toBe(0.8)
    expect(vmids(n)).toEqual(['50', '100', '101'])
    expect(n.maintenance).toBe(prev[0].nodes[0].maintenance)
  })

  it('does not mutate the previous state', () => {
    const prev = twoClusters()
    const snapshot = JSON.stringify(prev)
    applyInventoryEvents(prev, [
      vmRemoved({ vmid: 100 }),
      vmAdded({ vmid: 1 }),
      vmUpdate({ vmid: 101, type: 'lxc', status: 'stopped' }),
      nodeUpdate({ node: 'n2', status: 'offline' }),
    ])
    expect(JSON.stringify(prev)).toBe(snapshot)
  })
})
