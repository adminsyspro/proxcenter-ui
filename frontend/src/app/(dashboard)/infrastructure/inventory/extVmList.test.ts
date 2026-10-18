import { describe, expect, it } from 'vitest'

import { countExtVmPower, filterExtVms, filteredSelectionState, isSourcePoweredOn, toggleFilteredSelection } from './extVmList'

const vms = [
  { vmid: 'vm-1', name: 'web-01', status: 'poweredOn', guest_OS: 'Debian' },
  { vmid: 'vm-2', name: 'web-02', status: 'poweredOff', guest_OS: 'Debian' },
  { vmid: 'vm-3', name: 'db-01', status: 'running', guest_OS: 'Windows Server' },
  { vmid: 'vm-4', name: 'old', status: 'suspended' },
]

describe('extVmList (roadmap#53)', () => {
  it('treats VMware poweredOn and running alike', () => {
    expect(isSourcePoweredOn('poweredOn')).toBe(true)
    expect(isSourcePoweredOn('running')).toBe(true)
    expect(isSourcePoweredOn('poweredOff')).toBe(false)
  })

  it('filters by power state and by name, VMID or guest OS', () => {
    expect(filterExtVms(vms, '', 'running').map(v => v.vmid)).toEqual(['vm-1', 'vm-3'])
    expect(filterExtVms(vms, '', 'stopped').map(v => v.vmid)).toEqual(['vm-2', 'vm-4'])
    expect(filterExtVms(vms, ' WEB ', 'all').map(v => v.vmid)).toEqual(['vm-1', 'vm-2'])
    expect(filterExtVms(vms, 'windows', 'running').map(v => v.vmid)).toEqual(['vm-3'])
    expect(countExtVmPower(vms)).toEqual({ all: 4, running: 2, stopped: 2 })
  })

  it('selects and clears the filtered VMs only, keeping the rest of the selection', () => {
    const running = filterExtVms(vms, '', 'running')
    let sel = toggleFilteredSelection(new Set(['vm-2']), running, true)
    expect([...sel].sort((a, b) => a.localeCompare(b))).toEqual(['vm-1', 'vm-2', 'vm-3'])
    expect(filteredSelectionState(sel, running)).toBe('all')
    expect(filteredSelectionState(sel, filterExtVms(vms, '', 'stopped'))).toBe('some')
    sel = toggleFilteredSelection(sel, running, false)
    expect([...sel]).toEqual(['vm-2'])
    expect(filteredSelectionState(sel, running)).toBe('none')
  })
})
