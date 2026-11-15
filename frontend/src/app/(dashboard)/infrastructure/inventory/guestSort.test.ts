import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { compareGuestNames, GuestSortContext, parseGuestSortMode, sortClusterGuests } from './guestSort'
import type { TreeCluster } from './InventoryTree'

type Node = TreeCluster['nodes'][number]
type Guest = Node['vms'][number]

const guest = (vmid: number, name: string): Guest => ({
  type: 'qemu',
  vmid: String(vmid),
  name,
  status: 'running',
  cpu: 0,
  mem: 0,
  maxmem: 0,
  disk: 0,
  maxdisk: 0,
})

const cluster = (vms: Guest[]): TreeCluster => ({
  connId: 'c1',
  name: 'PVE',
  isCluster: true,
  cephHealth: undefined,
  nodes: [{ node: 'pve1', status: 'online', cpu: 0, mem: 0, maxmem: 0, vms }],
} as TreeCluster)

const names = (clusters: TreeCluster[]) => clusters[0].nodes[0].vms.map(vm => vm.name)

describe('parseGuestSortMode', () => {
  it('reads the stored name mode', () => {
    expect(parseGuestSortMode('name')).toBe('name')
  })

  it('falls back to vmid for anything else', () => {
    expect(parseGuestSortMode(null)).toBe('vmid')
    expect(parseGuestSortMode('vmid')).toBe('vmid')
    expect(parseGuestSortMode('bogus')).toBe('vmid')
  })
})

describe('compareGuestNames', () => {
  it('orders names naturally and ignores case', () => {
    const sorted = [guest(3, 'web10'), guest(1, 'Web2'), guest(2, 'api')].sort(compareGuestNames)

    expect(sorted.map(vm => vm.name)).toEqual(['api', 'Web2', 'web10'])
  })

  it('breaks a name tie by VMID', () => {
    const sorted = [guest(120, 'Debian13'), guest(100, 'Debian13')].sort(compareGuestNames)

    expect(sorted.map(vm => vm.vmid)).toEqual(['100', '120'])
  })
})

describe('sortClusterGuests', () => {
  const input = [cluster([guest(101, 'debian-test'), guest(102, 'Win2025'), guest(104, 'NginX'), guest(109, 'audb-victim')])]

  it('keeps the inventory order untouched in vmid mode', () => {
    expect(sortClusterGuests(input, 'vmid')).toBe(input)
  })

  it('sorts every node by name in name mode without mutating the input', () => {
    const out = sortClusterGuests(input, 'name')

    expect(names(out)).toEqual(['audb-victim', 'debian-test', 'NginX', 'Win2025'])
    expect(names(input)).toEqual(['debian-test', 'Win2025', 'NginX', 'audb-victim'])
  })
})

describe('GuestSortContext', () => {
  it('defaults to the VMID order with no toggle when no page provides it', () => {
    const html = renderToStaticMarkup(
      createElement(GuestSortContext.Consumer, { children: v => `${v.mode}:${typeof v.toggle}` })
    )

    expect(html).toBe('vmid:undefined')
  })
})
