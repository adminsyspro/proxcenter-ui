/**
 * The order of the guests in the lists a person picks from: the assign dialog and the guest picker of the map.
 */

import { describe, expect, it } from 'vitest'

import { assignRows } from './assignModel'
import { zone } from './microsegTestKit'
import { targetCandidates } from './targetModel'
import { byGuestName, type PolicyGuest } from './zoneModel'

const guest = (vmid: number, name: string, over: Partial<PolicyGuest> = {}): PolicyGuest => ({ vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ...over })

/** The inventory as Proxmox hands it: by VMID. */
const BY_VMID = [guest(100, 'Debian13'), guest(101, 'debian-test'), guest(102, 'Win2025'), guest(104, 'NginX'), guest(109, 'audb-victim'), guest(113, 'c7-i1000'), guest(7004, 'app-01')]
const BY_NAME = ['app-01', 'audb-victim', 'c7-i1000', 'debian-test', 'Debian13', 'NginX', 'Win2025']

describe('byGuestName', () => {
  it('reads the names whatever their case, a capital not before every small letter', () => {
    expect([...BY_VMID].sort(byGuestName).map(g => g.name)).toEqual(BY_NAME)
  })

  it('orders a number in a name by its value, and two guests of one name by VMID', () => {
    const list = [guest(3, 'web10'), guest(1, 'Web2'), guest(120, 'c7-i1000'), guest(114, 'c7-i1000'), guest(2, 'web1')]
    expect(list.sort(byGuestName).map(g => `${g.name} ${g.vmid}`)).toEqual(['c7-i1000 114', 'c7-i1000 120', 'web1 2', 'Web2 1', 'web10 3'])
  })
})

describe('the guests of the assign dialog', () => {
  it('lists every guest by name, not in the order of the inventory', () => {
    const web = zone('zw', { name: 'web' })
    const rows = assignRows(web, [web], 'zone-', BY_VMID, [])
    expect(rows.map(r => r.guest.name)).toEqual(BY_NAME)
    // The inventory itself is left as it was handed.
    expect(BY_VMID[0].name).toBe('Debian13')
  })
})

describe('the guests of the map picker', () => {
  it('lists the running guests in the same order', () => {
    expect(targetCandidates([...BY_VMID, guest(200, 'aaa-stopped', { status: 'stopped' })], new Map()).map(c => c.name)).toEqual(BY_NAME)
  })
})
