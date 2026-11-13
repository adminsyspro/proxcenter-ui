// GPU inventory and allocation map of one Proxmox connection (#672, phase 1).
//
// Pure functions only: the Proxmox reads live in collect.ts. Everything here
// works on the raw payloads of three endpoints:
//  - /nodes/{node}/hardware/pci: the PCI devices of a node;
//  - /cluster/mapping/pci: the datacenter resource mappings (PVE >= 8.0);
//  - /nodes/{node}/qemu/{vmid}/config: the `hostpciN` entries of a VM.

/** One row of /nodes/{node}/hardware/pci, as PVE returns it. */
export type PvePciEntry = {
  id: string
  class: string
  vendor?: string
  device?: string
  vendor_name?: string
  device_name?: string
  subsystem_vendor?: string
  subsystem_device?: string
  subsystem_vendor_name?: string
  subsystem_device_name?: string
  iommugroup?: number
  mdev?: number | boolean
  /** On an SR-IOV virtual function (NVIDIA vGPU on Ampere and later): its physical function. */
  physfn?: string
  /** On an SR-IOV physical function: its virtual functions, `virtfnN` -> address. */
  virtfns?: Record<string, string>
}

/** A PCI address normalised with its domain. `fn` null = every function of the slot. */
export type PciAddress = { slot: string; fn: string | null }

export type GpuKind = 'gpu' | 'console'

/** Why a display controller is set apart from the allocatable GPUs. */
export type ConsoleReason = 'vendor' | 'emulated'

export type GpuDevice = {
  /** `${connId}:${node}:${slot}` */
  key: string
  connId: string
  node: string
  /** Full address of the first display function, e.g. 0000:01:00.0 */
  id: string
  /** Address without the function, e.g. 0000:01:00 */
  slot: string
  /** Every function PVE lists in the slot (the GPU plus its audio or USB functions). */
  functions: string[]
  /** The display-class functions of the slot. */
  displayFunctions: string[]
  vendorId: string | null
  deviceId: string | null
  vendorName: string | null
  deviceName: string | null
  subsystemName: string | null
  classCode: string
  iommuGroup: number | null
  /** The IOMMU group holds no device of another slot (passthrough-ready). */
  iommuIsolated: boolean
  /** PVE reports mediated device (vGPU) support on the device or on its virtual functions. */
  mdev: boolean
  /**
   * The card shares itself out as vGPUs: through SR-IOV virtual functions
   * (NVIDIA Ampere and later, folded into this device) or through mediated
   * devices of the card itself (older generations). Null for a card that can
   * only be passed through whole.
   */
  vgpu: {
    mode: 'sriov' | 'mdev'
    virtualFunctions: string[]
    iommuGroups?: Array<number | null>
    /** Subsystem ID of the virtual functions ("10de:0000"): PVE wants it in their mapping. */
    subsystemId?: string | null
  } | null
  kind: GpuKind
  consoleReason: ConsoleReason | null
  /** Resource mappings that point at this device on its node. */
  mappings: string[]
  /** Those of them that hand out vGPUs ("use with mediated devices"). */
  vgpuMappings?: string[]
}

export type PciMapping = {
  id: string
  /** "Use with mediated devices": the mapping hands out vGPUs (`mdev=` on the hostpciN). */
  mdev?: boolean
  entries: Array<{ node: string; paths: PciAddress[] }>
}

export type HostpciRef = {
  /** hostpci0, hostpci1, ... */
  slot: string
  addresses: PciAddress[]
  mapping: string | null
  mdev: string | null
}

export type GpuAllocation = {
  deviceKey: string
  connId: string
  node: string
  vmid: string
  vmName: string
  vmStatus: string
  template: boolean
  pool: string | null
  tags: string[]
  hostpci: string
  via: 'address' | 'mapping'
  mapping: string | null
  mdev: string | null
  /** Mapping with several devices on the node: PVE picks one at start, the map shows a best guess. */
  pooled: boolean
  /** Seconds since the guest started, from /cluster/resources (null when stopped or unknown). */
  uptime: number | null
  /** UUID of the guest's SMBIOS table (`smbios1`): how a vGPU host names the VM. */
  smbiosUuid: string | null
  /** The hostpciN is marked for deletion: the VM keeps the GPU until it stops. */
  pendingRemoval: boolean
}

/** The `uuid=` of a VM's `smbios1`, lower-cased; null when the config has none. */
export function smbiosUuidOf(config: Record<string, unknown> | null | undefined): string | null {
  const raw = config?.smbios1
  if (typeof raw !== 'string') return null
  const uuid = propertyString(raw).get('uuid')
  return uuid && /^[0-9a-f-]{36}$/i.test(uuid) ? uuid.toLowerCase() : null
}

export type GuestForAllocation = {
  vmid: string
  node: string
  name: string
  status: string
  template: boolean
  pool: string | null
  tags: string[]
  /** Seconds since start, from /cluster/resources. */
  uptime?: number | null
  config: Record<string, unknown> | null
  /** hostpciN of the config whose removal is pending (the VM still holds them). */
  pendingDelete?: string[]
}

// Display controllers (PCI base class 0x03) that a GPU inventory counts:
// 0x0300 VGA compatible, 0x0302 3D controller (headless datacenter GPUs such
// as NVIDIA A100/H100 or L4), 0x0380 other display controller.
const DISPLAY_SUBCLASSES = new Set(['0300', '0302', '0380'])

// Vendors whose display controllers are a console, not an allocatable GPU:
// the VGA chip of a BMC (ASPEED, Matrox G200e, Huawei iBMC) and the emulated
// adapters of a hypervisor (a PVE node that is itself a VM, as in a nested lab).
const CONSOLE_VENDORS = new Set([
  '0x1a03', // ASPEED (AST2400/2500/2600 BMC)
  '0x102b', // Matrox (G200e family on server boards)
  '0x1234', // QEMU/Bochs standard VGA (0x1234:0x1111)
  '0x1b36', // Red Hat QXL
  '0x1af4', // VirtIO GPU
  '0x15ad', // VMware SVGA
  '0x1013', // Cirrus Logic (emulated CL-GD5446)
  '0x80ee', // VirtualBox VGA
])
const CONSOLE_DEVICES = new Set([
  '0x19e5:0x1711', // Huawei iBMC VGA
])

// Names shown when PVE's pci.ids lookup returns none (a nested lab node shows
// its QEMU VGA without any vendor name).
const KNOWN_VENDOR_NAMES: Record<string, string> = {
  '0x10de': 'NVIDIA Corporation',
  '0x1002': 'Advanced Micro Devices, Inc. [AMD/ATI]',
  '0x8086': 'Intel Corporation',
  '0x1a03': 'ASPEED Technology, Inc.',
  '0x102b': 'Matrox Electronics Systems Ltd.',
  '0x1234': 'QEMU/Bochs',
  '0x1b36': 'Red Hat, Inc.',
  '0x1af4': 'Red Hat, Inc. (VirtIO)',
  '0x15ad': 'VMware',
  '0x1013': 'Cirrus Logic',
  '0x80ee': 'VirtualBox',
  '0x19e5': 'Huawei Technologies Co., Ltd.',
}
const KNOWN_DEVICE_NAMES: Record<string, string> = {
  '0x1234:0x1111': 'Standard VGA (emulated)',
}

const ADDRESS_RE = /^(?:([0-9a-f]{4}):)?([0-9a-f]{2}):([0-9a-f]{2})(?:\.([0-7]))?$/i

export function parsePciAddress(raw: unknown): PciAddress | null {
  if (typeof raw !== 'string') return null
  const m = ADDRESS_RE.exec(raw.trim())
  if (!m) return null
  const domain = (m[1] ?? '0000').toLowerCase()
  return { slot: `${domain}:${m[2].toLowerCase()}:${m[3].toLowerCase()}`, fn: m[4] ?? null }
}

/** "0x030000" -> "0300"; null when the class is not a display controller. */
export function displaySubclass(classCode: unknown): string | null {
  if (typeof classCode !== 'string') return null
  const hex = classCode.trim().toLowerCase().replace(/^0x/, '')
  const sub = hex.slice(0, 4)
  return DISPLAY_SUBCLASSES.has(sub) ? sub : null
}

/**
 * Tells an allocatable GPU from an integrated display controller or console.
 * Heuristic, documented in the issue: a known BMC or emulated vendor
 * (ASPEED, Matrox, QEMU/Bochs 0x1234:0x1111, QXL, VirtIO, VMware, Cirrus,
 * VirtualBox, Huawei iBMC) is a console; so is a controller that PVE can name
 * no vendor for AND that sits in no IOMMU group, which is what an emulated
 * adapter looks like when pci.ids does not know it.
 */
export function classifyDisplayEntry(entry: PvePciEntry): { kind: GpuKind; reason: ConsoleReason | null } {
  const vendor = (entry.vendor ?? '').toLowerCase()
  const device = (entry.device ?? '').toLowerCase()
  if (CONSOLE_VENDORS.has(vendor) || CONSOLE_DEVICES.has(`${vendor}:${device}`)) {
    return { kind: 'console', reason: 'vendor' }
  }
  const noVendorName = !entry.vendor_name || !String(entry.vendor_name).trim()
  const noIommu = typeof entry.iommugroup !== 'number' || entry.iommugroup < 0
  if (noVendorName && noIommu) return { kind: 'console', reason: 'emulated' }
  return { kind: 'gpu', reason: null }
}

function fnOf(id: string): string {
  const addr = parsePciAddress(id)
  return addr?.fn ?? '0'
}

/** Splits a PVE property string ("a=1,b=2") into a map; a bare first token lands under `''`. */
function propertyString(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of raw.split(',')) {
    const token = part.trim()
    if (!token) continue
    const eq = token.indexOf('=')
    if (eq < 0) {
      if (!out.has('')) out.set('', token)
      continue
    }
    out.set(token.slice(0, eq).trim(), token.slice(eq + 1).trim())
  }
  return out
}

function parseAddressList(raw: string | undefined): PciAddress[] {
  if (!raw) return []
  return raw
    .split(';')
    .map(parsePciAddress)
    .filter((a): a is PciAddress => a !== null)
}

const isFlag = (v: unknown) => v === true || Number(v) === 1

/** "0x10de" + "0x0000" -> "10de:0000"; null when PVE gives either half no value. */
function subsystemIdOf(entry: PvePciEntry | undefined): string | null {
  const v = (entry?.subsystem_vendor ?? '').replace(/^0x/i, '').toLowerCase()
  const d = (entry?.subsystem_device ?? '').replace(/^0x/i, '').toLowerCase()
  return /^[0-9a-f]{4}$/.test(v) && /^[0-9a-f]{4}$/.test(d) ? `${v}:${d}` : null
}

/** /cluster/mapping/pci: `map` is a list of property strings (or objects on some versions). */
export function parsePciMappings(raw: unknown): PciMapping[] {
  if (!Array.isArray(raw)) return []
  const out: PciMapping[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = (item as any).id
    if (typeof id !== 'string' || !id) continue
    const map = Array.isArray((item as any).map) ? (item as any).map : []
    const entries: PciMapping['entries'] = []
    for (const m of map) {
      let node: string | undefined
      let path: string | undefined
      if (typeof m === 'string') {
        const props = propertyString(m)
        node = props.get('node')
        path = props.get('path')
      } else if (m && typeof m === 'object') {
        node = typeof m.node === 'string' ? m.node : undefined
        path = typeof m.path === 'string' ? m.path : undefined
      }
      const paths = parseAddressList(path)
      if (node && paths.length) entries.push({ node, paths })
    }
    out.push({ id, mdev: isFlag((item as any).mdev), entries })
  }
  return out
}

/** Every `hostpciN` of a VM config, with its addresses or its mapping. */
export function parseHostpciEntries(config: Record<string, unknown> | null | undefined): HostpciRef[] {
  if (!config) return []
  const refs: HostpciRef[] = []
  for (const [key, value] of Object.entries(config)) {
    if (!/^hostpci\d+$/.test(key) || typeof value !== 'string') continue
    const props = propertyString(value)
    const host = props.get('host') ?? props.get('')
    refs.push({
      slot: key,
      addresses: parseAddressList(host),
      mapping: props.get('mapping') || null,
      mdev: props.get('mdev') || null,
    })
  }
  return refs.sort((a, b) => Number(a.slot.slice(7)) - Number(b.slot.slice(7)))
}

export function addressMatchesDevice(addr: PciAddress, device: Pick<GpuDevice, 'slot' | 'displayFunctions' | 'vgpu'>): boolean {
  // A virtual function belongs to its card: a mapping of vGPU functions points at it.
  const vfs = device.vgpu?.virtualFunctions ?? []
  if (vfs.length && (addr.fn === null ? vfs.some(v => v.startsWith(`${addr.slot}.`)) : vfs.includes(`${addr.slot}.${addr.fn}`))) return true
  if (addr.slot !== device.slot) return false
  if (addr.fn === null) return true
  return device.displayFunctions.includes(`${addr.slot}.${addr.fn}`)
}

/**
 * The display devices of one node: PCI entries grouped by slot, one device per
 * slot holding at least one display-class function (its audio function rides
 * along in `functions`). The SR-IOV virtual functions of a card (24 of them
 * on an RTX A5000 in vGPU mode, spread over several slots) are folded into
 * the card: they are its vGPU slots, not GPUs of their own.
 */
export function collectNodeDevices(
  connId: string,
  node: string,
  entries: PvePciEntry[],
  mappings: PciMapping[] = [],
): GpuDevice[] {
  const bySlot = new Map<string, PvePciEntry[]>()
  const slotsByGroup = new Map<number, Set<string>>()
  const vfsByPhysfn = new Map<string, PvePciEntry[]>()
  for (const entry of entries) {
    const addr = parsePciAddress(entry?.id)
    if (!addr) continue
    const pf = typeof entry.physfn === 'string' ? parsePciAddress(entry.physfn) : null
    if (pf && displaySubclass(entry.class) !== null) {
      const key = `${pf.slot}.${pf.fn ?? '0'}`
      vfsByPhysfn.set(key, [...(vfsByPhysfn.get(key) ?? []), entry])
      continue
    }
    const list = bySlot.get(addr.slot) ?? []
    list.push(entry)
    bySlot.set(addr.slot, list)
    if (typeof entry.iommugroup === 'number' && entry.iommugroup >= 0) {
      const slots = slotsByGroup.get(entry.iommugroup) ?? new Set<string>()
      slots.add(addr.slot)
      slotsByGroup.set(entry.iommugroup, slots)
    }
  }

  const devices: GpuDevice[] = []
  for (const [slot, list] of bySlot) {
    const sorted = [...list].sort((a, b) => fnOf(a.id).localeCompare(fnOf(b.id)))
    const display = sorted.filter((e) => displaySubclass(e.class) !== null)
    if (display.length === 0) continue
    const primary = display[0]
    const { kind, reason } = classifyDisplayEntry(primary)
    const group = typeof primary.iommugroup === 'number' && primary.iommugroup >= 0 ? primary.iommugroup : null
    const subsystem = [primary.subsystem_vendor_name, primary.subsystem_device_name].filter(Boolean).join(' ')
    const vfRows = (vfsByPhysfn.get(`${slot}.${fnOf(primary.id)}`) ?? [])
      .map(e => ({ addr: parsePciAddress(e.id), group: typeof e.iommugroup === 'number' && e.iommugroup >= 0 ? e.iommugroup : null }))
      .filter((r): r is { addr: PciAddress; group: number | null } => r.addr !== null)
      .map(r => ({ id: `${r.addr.slot}.${r.addr.fn ?? '0'}`, group: r.group }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const vfs = vfRows.map(r => r.id)
    const ownMdev = display.some(e => isFlag(e.mdev))
    const vfMdev = (vfsByPhysfn.get(`${slot}.${fnOf(primary.id)}`) ?? []).some(e => isFlag(e.mdev))
    const device: GpuDevice = {
      key: `${connId}:${node}:${slot}`,
      connId,
      node,
      id: `${slot}.${fnOf(primary.id)}`,
      slot,
      functions: sorted.map((e) => `${slot}.${fnOf(e.id)}`),
      displayFunctions: display.map((e) => `${slot}.${fnOf(e.id)}`),
      vendorId: primary.vendor ?? null,
      deviceId: primary.device ?? null,
      vendorName: primary.vendor_name || KNOWN_VENDOR_NAMES[(primary.vendor ?? '').toLowerCase()] || null,
      deviceName:
        primary.device_name ||
        KNOWN_DEVICE_NAMES[`${(primary.vendor ?? '').toLowerCase()}:${(primary.device ?? '').toLowerCase()}`] ||
        null,
      subsystemName: subsystem || null,
      classCode: primary.class,
      iommuGroup: group,
      iommuIsolated: group !== null && (slotsByGroup.get(group)?.size ?? 0) <= 1,
      mdev: ownMdev || vfMdev,
      vgpu: vfs.length
        ? { mode: 'sriov', virtualFunctions: vfs, iommuGroups: vfRows.map(r => r.group), subsystemId: subsystemIdOf(vfsByPhysfn.get(`${slot}.${fnOf(primary.id)}`)?.[0]) }
        : ownMdev
          ? { mode: 'mdev', virtualFunctions: [] }
          : null,
      kind,
      consoleReason: reason,
      mappings: [],
    }
    for (const mapping of mappings) {
      const hit = mapping.entries.some(
        (e) => e.node === node && e.paths.some((p) => addressMatchesDevice(p, device)),
      )
      if (hit) {
        device.mappings.push(mapping.id)
        if (mapping.mdev) (device.vgpuMappings ??= []).push(mapping.id)
      }
    }
    devices.push(device)
  }
  return devices.sort((a, b) => a.slot.localeCompare(b.slot))
}

const RUNNING_FIRST = (a: GuestForAllocation, b: GuestForAllocation) =>
  Number(b.status === 'running') - Number(a.status === 'running') || Number(a.vmid) - Number(b.vmid)

/**
 * Cross-references the `hostpciN` entries of the guests with the display
 * devices of their node. A raw address matches its slot (`01:00`, every
 * function) or one display function (`01:00.0`); an audio-only `01:00.1`
 * allocates no GPU. A `mapping=` resolves through the mapping entries of the
 * guest's node; when a mapping offers several devices there, PVE picks a free
 * one at start, so the running guests claim first and the guess is flagged.
 */
export function resolveAllocations(
  connId: string,
  devices: GpuDevice[],
  mappings: PciMapping[],
  guests: GuestForAllocation[],
): GpuAllocation[] {
  const byNode = new Map<string, GpuDevice[]>()
  for (const d of devices) {
    const list = byNode.get(d.node) ?? []
    list.push(d)
    byNode.set(d.node, list)
  }
  const mappingById = new Map(mappings.map((m) => [m.id, m]))
  const claimed = new Set<string>()
  const out: GpuAllocation[] = []

  for (const guest of [...guests].sort(RUNNING_FIRST)) {
    const nodeDevices = byNode.get(guest.node)
    if (!nodeDevices?.length) continue
    for (const ref of parseHostpciEntries(guest.config)) {
      const base = {
        connId,
        node: guest.node,
        vmid: guest.vmid,
        vmName: guest.name,
        vmStatus: guest.status,
        template: guest.template,
        pool: guest.pool,
        tags: guest.tags,
        hostpci: ref.slot,
        mdev: ref.mdev,
        uptime: guest.status === 'running' && guest.uptime ? guest.uptime : null,
        smbiosUuid: smbiosUuidOf(guest.config),
        pendingRemoval: guest.pendingDelete?.includes(ref.slot) ?? false,
      }
      const hits = new Map<string, GpuDevice>()
      let via: GpuAllocation['via'] = 'address'
      let pooled = false

      if (ref.addresses.length) {
        for (const addr of ref.addresses) {
          for (const d of nodeDevices) if (addressMatchesDevice(addr, d)) hits.set(d.key, d)
        }
      } else if (ref.mapping) {
        via = 'mapping'
        const candidates = (mappingById.get(ref.mapping)?.entries ?? [])
          .filter((e) => e.node === guest.node)
          .map((e) => nodeDevices.filter((d) => e.paths.some((p) => addressMatchesDevice(p, d))))
          .filter((c) => c.length > 0)
        // A vGPU mapping lists the virtual functions of one card: one device, not a pool.
        if (new Set(candidates.map((c) => c.map((d) => d.key).join('|'))).size > 1) pooled = true
        // vGPUs share their card: several guests take the same one.
        const pick = (ref.mdev ? candidates[0] : candidates.find((c) => c.every((d) => !claimed.has(d.key)))) ?? candidates[0] ?? []
        for (const d of pick) hits.set(d.key, d)
      }

      for (const d of hits.values()) {
        claimed.add(d.key)
        out.push({ ...base, deviceKey: d.key, via, mapping: ref.mapping, pooled })
      }
    }
  }
  return out
}

export type GpuCapacity = {
  /** Allocatable GPUs (consoles excluded). */
  total: number
  /** GPUs referenced by at least one VM config. */
  allocated: number
  /** GPUs referenced by no VM config. */
  free: number
  /** GPUs held by a running VM. */
  inUse: number
  /** Integrated display or console controllers, never counted as capacity. */
  consoles: number
}

export function computeCapacity(devices: GpuDevice[], allocations: GpuAllocation[]): GpuCapacity {
  const allocated = new Set<string>()
  const running = new Set<string>()
  for (const a of allocations) {
    allocated.add(a.deviceKey)
    if (a.vmStatus === 'running') running.add(a.deviceKey)
  }
  let total = 0
  let used = 0
  let inUse = 0
  let consoles = 0
  for (const d of devices) {
    if (d.kind === 'console') {
      consoles++
      continue
    }
    total++
    if (allocated.has(d.key)) used++
    if (running.has(d.key)) inUse++
  }
  return { total, allocated: used, free: total - used, inUse, consoles }
}
