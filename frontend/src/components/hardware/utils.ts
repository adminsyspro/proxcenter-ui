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

// ---------------------------------------------------------------------------
// USB / PCI passthrough through datacenter resource mappings (#852)
// ---------------------------------------------------------------------------

// Split a PVE property string ("head,k=v,k=v" or "k=v,k=v") into its
// positional head (the default key, e.g. the PCI address or "spice") and
// its keyed parameters. A bare flag without "=" counts as "1".
export function parsePropertyString(raw: string): { head: string; params: Record<string, string> } {
  const parts = String(raw || '').split(',').map(p => p.trim()).filter(Boolean)
  const params: Record<string, string> = {}
  let head = ''

  parts.forEach((p, idx) => {
    const eq = p.indexOf('=')

    if (eq > -1) {
      params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
    } else if (idx === 0) {
      head = p
    } else {
      params[p] = '1'
    }
  })

  return { head, params }
}

// One entry of GET /cluster/mapping/{usb|pci} (PVE >= 8.0). `map` holds one
// property string per node, e.g. "node=pve1,id=0627:0001" for USB or
// "node=pve1,path=0000:01:00.0,id=10de:1c82,iommugroup=1" for PCI. When the
// list is requested with check-node, PVE reports per-node problems in
// `checks` (PCI) or `errors` (USB; its API schema spells it `error`, the
// server sends `errors`, PVE 9.2 observed).
export type MappingIssue = { severity?: string; message?: string }

export type ResourceMapping = {
  id: string
  description?: string
  map?: string[]
  checks?: MappingIssue[]
  errors?: MappingIssue[]
  error?: MappingIssue[]
}

export type MappingKind = 'usb' | 'pci'

// Node names a mapping has an entry for.
export const mappingNodes = (mapping: ResourceMapping): string[] =>
  (mapping.map || []).map(entry => parsePropertyString(entry).params.node).filter(Boolean)

export const mappingCoversNode = (mapping: ResourceMapping, node: string): boolean =>
  mappingNodes(mapping).includes(node)

// Problems PVE reported for the mapping on the checked node, as plain messages.
export const mappingIssues = (mapping: ResourceMapping): string[] =>
  [...(mapping.checks || []), ...(mapping.errors || []), ...(mapping.error || [])]
    .map(issue => String(issue?.message || '').trim())
    .filter(Boolean)

// Config values PVE accepts from a non-root caller holding Mapping.Use on the
// mapping: "mapping=<id>" plus the device options.
export const usbMappingValue = (mappingId: string, usb3: boolean): string =>
  `mapping=${mappingId}${usb3 ? ',usb3=1' : ''}`

export const pciMappingValue = (
  mappingId: string,
  opts: { pcie: boolean; rombar: boolean; primaryGpu: boolean },
): string =>
  [`mapping=${mappingId}`, opts.pcie && 'pcie=1', opts.rombar && 'rombar=1', opts.primaryGpu && 'x-vga=1']
    .filter(Boolean)
    .join(',')

// A device given by its real hardware address (host=vendor:product or a USB
// port for usbN, a PCI address for hostpciN) instead of a mapping. PVE lets
// only root@pam logged in with a password add, edit or remove those, and an
// API token is never root@pam for that check (qemu-server check_usb_perm /
// check_hostpci_perm), so ProxCenter can only show them (#852). SPICE USB
// redirection is not a real device.
export const isRawPassthrough = (type: MappingKind, rawValue: string): boolean => {
  const { head, params } = parsePropertyString(rawValue)

  if (params.mapping) return false
  if (type === 'pci') return true

  return head.toLowerCase() !== 'spice' && (params.host || '').toLowerCase() !== 'spice'
}

// Mappings of one kind visible to the connection's token, checked against
// `node` when given. Throws with the API error so the dialog can show it.
export const fetchResourceMappings = async (
  connId: string,
  kind: MappingKind,
  node?: string,
): Promise<ResourceMapping[]> => {
  const query = node ? `?node=${encodeURIComponent(node)}` : ''
  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/mapping/${kind}${query}`)
  const json = await res.json().catch(() => null)

  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

  return Array.isArray(json?.data) ? json.data : []
}
