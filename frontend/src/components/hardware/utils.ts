// QoS caps carried by a storage policy attached to a vDC (Task 14). Null caps
// mean "no limit on that axis", not "unset". The server strips-and-stamps
// these on save regardless of what the client sends, so the UI only needs to
// show them, never enforce them.
export type StoragePolicyCaps = {
  name: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
}

// Types pour les storages
export type Storage = {
  storage: string
  type: string
  avail?: number
  total?: number
  content?: string
  /** Formats this storage accepts for a VM disk, computed by the API (issue #735). */
  formats?: string[]
  /** Format PVE picks when none is given. */
  defaultFormat?: string
  /** Present when a tenant's vDC storage policy governs this storage (iaas only). */
  policy?: StoragePolicyCaps
}

export type NodeInfo = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

export type StorageInfo = {
  storage: string
  type: string
  avail?: number
  total?: number
  shared?: number
  content?: string
}

// Fonctions utilitaires partagees entre MigrateVmDialog et CloneVmDialog

export const calculateNodeScore = (node: NodeInfo): number => {
  const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
  const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50


return cpuFree * 0.4 + memFree * 0.6
}

export const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo => {
  return nodeList.reduce((best, current) => {
    const bestScore = calculateNodeScore(best)
    const currentScore = calculateNodeScore(current)


return currentScore > bestScore ? current : best
  }, nodeList[0])
}

export const formatMemory = (bytes?: number): string => {
  if (!bytes) return '\u2014'
  const gb = bytes / 1024 / 1024 / 1024


return `${gb.toFixed(1)} GB`
}

// Minimal shape of an inventory guest for VMID accounting. The inventory list
// merges every connection, hence the connId.
export type VmidOwner = { connId?: string; vmid: number | string }

// VMIDs already taken on `connId`. Guests on the OTHER connections are left out
// on purpose: Proxmox only requires a VMID to be unique inside its own cluster,
// and neither a clone nor a create ever crosses a connection. Feeding the whole
// inventory to a dialog made it refuse ids that were free on the target cluster
// (#724). Falls back to every connection while none is selected, which is the
// best guess available at that point.
export const usedVmidsOnConnection = <T extends VmidOwner>(vms: T[], connId?: string): number[] =>
  (connId ? vms.filter(vm => vm.connId === connId) : vms)
    .map(vm => Number.parseInt(String(vm.vmid), 10))
    .filter(id => Number.isInteger(id) && id > 0)

// Client-side estimate of the next free VMID on `connId`, used only as a seed
// or when the server suggestion is unavailable.
export const nextVmidOnConnection = <T extends VmidOwner>(vms: T[], connId?: string): number => {
  const used = usedVmidsOnConnection(vms, connId)
  const highest = used.length === 0 ? 0 : Math.max(...used)

  return Math.max(100, highest + 1)
}

// Cluster-wide next free VMID from PVE (/cluster/nextid). Returns null when the
// endpoint fails or yields something below the 100 floor, so callers can fall
// back to their own estimate. Used by CloneVmDialog (both its open-effect and
// the "next id" button) to match the "New VM" screen's next-available default.
export const fetchNextVmid = async (connId: string): Promise<number | null> => {
  try {
    const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/nextid`)

    if (!res.ok) return null
    const json = await res.json()
    const id = Number(json?.data)


return Number.isFinite(id) && id >= 100 ? id : null
  } catch {
    return null
  }
}
