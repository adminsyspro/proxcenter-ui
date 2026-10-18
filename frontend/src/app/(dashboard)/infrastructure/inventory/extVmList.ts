// The VMs of a source hypervisor (VMware, XCP-ng, Hyper-V, Nutanix) as the
// migration screens list them (roadmap#53): powered state, search, power
// filter and selection across pages. Pure, shared by the host's VM table and
// the bulk migration dialog.

export type ExtVmPowerFilter = 'all' | 'running' | 'stopped'

export interface ExtVmLike {
  vmid: string
  name?: string
  status?: string
  guest_OS?: string
}

/** Powered on, whatever the source calls it ("running" on XCP-ng/Proxmox-like APIs, "poweredOn" on VMware). */
export const isSourcePoweredOn = (status?: string) => status === 'running' || status === 'poweredOn'

/** Paused or suspended: neither running nor down. */
export const isSourcePaused = (status?: string) => status === 'paused' || status === 'suspended'

export function filterExtVms<T extends ExtVmLike>(vms: T[], query: string, power: ExtVmPowerFilter): T[] {
  const q = query.trim().toLowerCase()
  return vms.filter(vm => {
    if (power === 'running' && !isSourcePoweredOn(vm.status)) return false
    if (power === 'stopped' && isSourcePoweredOn(vm.status)) return false
    if (!q) return true
    return [vm.name, vm.vmid, vm.guest_OS].some(v => (v || '').toLowerCase().includes(q))
  })
}

export function countExtVmPower(vms: ExtVmLike[]): { all: number; running: number; stopped: number } {
  const running = vms.filter(vm => isSourcePoweredOn(vm.status)).length
  return { all: vms.length, running, stopped: vms.length - running }
}

/** The header checkbox state over the filtered VMs, whatever page shows. */
export function filteredSelectionState(selected: Set<string>, filtered: ExtVmLike[]): 'none' | 'some' | 'all' {
  const n = filtered.filter(vm => selected.has(vm.vmid)).length
  if (n === 0) return 'none'
  return n === filtered.length ? 'all' : 'some'
}

/** Select or clear every filtered VM, keeping the selection outside the filter. */
export function toggleFilteredSelection(selected: Set<string>, filtered: ExtVmLike[], select: boolean): Set<string> {
  const next = new Set(selected)
  for (const vm of filtered) {
    if (select) next.add(vm.vmid)
    else next.delete(vm.vmid)
  }
  return next
}
