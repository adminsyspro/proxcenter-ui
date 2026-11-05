// GPU actions (#672, lot C): attach a GPU to a VM, release it. Pure helpers,
// the route lives in app/api/v1/gpu/actions.
//
// Proxmox lets only root@pam logged in with a password add or remove a
// hostpciN given by its raw PCI address; an API token is refused even when it
// is root's ("only root can set 'hostpciN' config for non-mapped devices",
// checked on PVE 9.2). ProxCenter therefore attaches through a resource
// mapping, creating one for the card when none covers it, and can release a
// mapped allocation only. A raw one gets the qm command an administrator runs.
import type { GpuDevice } from './inventory'

export const MAX_HOSTPCI = 16

/** The first free hostpciN of a VM config, -1 when all sixteen are taken. */
export function nextHostpciIndex(config: Record<string, unknown>): number {
  for (let i = 0; i < MAX_HOSTPCI; i++) {
    if (config[`hostpci${i}`] === undefined) return i
  }
  return -1
}

/** q35 machines take the GPU as a PCIe device; i440fx ones (the PVE default) cannot. */
export function isQ35(config: Record<string, unknown>): boolean {
  return /(^|[,=])(pc-)?q35/.test(String(config.machine ?? ''))
}

export function hostpciValue(mappingId: string, config: Record<string, unknown>, profile?: string | null): string {
  const parts = [`mapping=${mappingId}`]
  if (profile) parts.push(`mdev=${profile}`)
  if (isQ35(config)) parts.push('pcie=1')
  return parts.join(',')
}

/** A vGPU profile as PVE names it: nvidia-<type id>. */
export const VGPU_PROFILE = /^nvidia-\d{1,5}$/

/** The mapping id ProxCenter creates for the vGPU slots of one card. */
export function vgpuMappingIdFor(device: Pick<GpuDevice, 'node' | 'slot'>): string {
  return `${mappingIdFor(device).slice(0, 59)}-vgpu`
}

/**
 * The `map` entries of a vGPU mapping: one per virtual function of the card,
 * each with its subsystem ID and IOMMU group: PVE refuses to start a VM on a
 * mapping that lacks either ("missing expected property", PVE 9.2). Null when
 * the card has no virtual function or an unknown ID.
 */
export function vgpuMapEntries(device: Pick<GpuDevice, 'node' | 'vendorId' | 'deviceId' | 'vgpu'>): string[] | null {
  const vendor = hex(device.vendorId)
  const id = hex(device.deviceId)
  const vfs = device.vgpu?.mode === 'sriov' ? device.vgpu.virtualFunctions : []
  if (!vendor || !id || !vfs.length) return null
  return vfs.map((path, i) => {
    const group = device.vgpu?.iommuGroups?.[i]
    const subsystem = device.vgpu?.subsystemId
    return [
      `node=${device.node}`,
      `path=${path}`,
      `id=${vendor}:${id}`,
      ...(subsystem ? [`subsystem-id=${subsystem}`] : []),
      ...(typeof group === 'number' ? [`iommugroup=${group}`] : []),
    ].join(',')
  })
}

/** A hostpciN value given through a mapping, the only kind ProxCenter may remove. */
export function isMappedHostpci(value: unknown): boolean {
  return typeof value === 'string' && /(^|,)mapping=/.test(value)
}

/** The mapping id ProxCenter creates for one card: gpu-<node>-<bus>-<device>. */
export function mappingIdFor(device: Pick<GpuDevice, 'node' | 'slot'>): string {
  const node = device.node.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const bus = device.slot.replace(/^[0-9a-f]{4}:/i, '').toLowerCase().replace(/[^0-9a-f]+/g, '-')
  return `gpu-${node}-${bus}`.slice(0, 64).replace(/-+$/, '')
}

const hex = (id: string | null) => (id ?? '').replace(/^0x/i, '').toLowerCase()

/** The `map` entry of that mapping on the card's node. */
export function mappingMapEntry(device: Pick<GpuDevice, 'node' | 'slot' | 'vendorId' | 'deviceId' | 'iommuGroup'>): string | null {
  const vendor = hex(device.vendorId)
  const id = hex(device.deviceId)
  if (!vendor || !id) return null
  const parts = [`node=${device.node}`, `path=${device.slot}`, `id=${vendor}:${id}`]
  if (device.iommuGroup !== null) parts.push(`iommugroup=${device.iommuGroup}`)
  return parts.join(',')
}

/** What an administrator runs as root on the node to release a raw allocation. */
export function rawReleaseCommand(vmid: string | number, hostpci: string): string {
  return `qm set ${vmid} --delete ${hostpci}`
}
