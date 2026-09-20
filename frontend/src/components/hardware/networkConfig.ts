/** Merge a dialog's editable fields without dropping opaque Proxmox options. */
import { QEMU_NIC_MODELS } from '@/lib/rbac/nicPermissions'

const qemuModels = QEMU_NIC_MODELS

type NicIdentityPermissions = { canEditMac: boolean; canEditVlan: boolean }

function fields(raw: string) {
  return new Map(raw.split(',').filter(Boolean).map(part => {
    const split = part.indexOf('=')
    return split < 0 ? [part, ''] : [part.slice(0, split), part.slice(split + 1)]
  }))
}

export function mergeNetworkConfig(
  original: string,
  edited: string,
  type: 'qemu' | 'lxc',
  editableFields: string[],
  permissions: NicIdentityPermissions,
): string {
  const current = fields(original)
  const changes = fields(edited)
  const previousModel = [...current.keys()].find(key => qemuModels.has(key))
  const nextModel = [...changes.keys()].find(key => qemuModels.has(key)) ?? previousModel ?? 'virtio'
  const mac = permissions.canEditMac
    ? (type === 'lxc' ? changes.get('hwaddr') : changes.get('macaddr') ?? changes.get(nextModel))
    : (type === 'lxc' ? current.get('hwaddr') : current.get('macaddr') ?? (previousModel ? current.get(previousModel) : undefined))

  for (const key of editableFields) {
    if (key === 'tag' && !permissions.canEditVlan) continue
    if (key === 'hwaddr' || key === 'macaddr') continue
    if (changes.has(key)) current.set(key, changes.get(key)!)
    else current.delete(key)
  }

  if (type === 'lxc') {
    if (mac) current.set('hwaddr', mac)
    else current.delete('hwaddr')
  } else {
    for (const model of qemuModels) current.delete(model)
    current.delete('macaddr')
  }

  const parts = [...current].map(([key, value]) => value || original.split(',').includes(`${key}=`) ? `${key}=${value}` : key)
  if (type === 'qemu') parts.unshift(mac ? `${nextModel}=${mac}` : nextModel)
  return parts.join(',')
}
