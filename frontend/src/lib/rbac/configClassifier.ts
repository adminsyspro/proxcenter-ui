import { PERMISSIONS } from './index'
import { normalizedNicProperties } from './nicPermissions'

type ConfigPerm = typeof PERMISSIONS[keyof typeof PERMISSIONS]

const BOOT_KEYS = new Set(['boot', 'bootdisk', 'bios', 'machine'])

const CPU_KEYS = new Set([
  'cores', 'sockets', 'cpu', 'vcpus', 'cpulimit', 'cpuunits', 'numa',
])

const MEMORY_KEYS = new Set(['memory', 'balloon', 'shares', 'swap'])

const HARDWARE_SCALAR_KEYS = new Set(['scsihw', 'vga'])

const HARDWARE_INDEXED_RE = /^(virtio|unused|hostpci|usb|efidisk|tpmstate|serial|audio)\d+$/

const DISK_RE = /^(ide|sata|scsi)\d+$/

const NET_RE = /^net\d+$/

function isLinkOnlyChange(
  key: string,
  newValue: unknown,
  currentConfig: Record<string, unknown>,
): boolean {
  const oldStr = String(currentConfig[key] ?? '')
  const newStr = String(newValue ?? '')
  if (!oldStr || !newStr) return false

  const oldMap = normalizedNicProperties(oldStr)
  const newMap = normalizedNicProperties(newStr)

  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()])
  for (const k of allKeys) {
    if (k === 'link_down') continue
    if (oldMap.get(k) !== newMap.get(k)) return false
  }
  return oldMap.get('link_down') !== newMap.get('link_down')
}

export function classifyConfigKey(
  key: string,
  value: unknown,
  currentConfig?: Record<string, unknown>,
): ConfigPerm {
  if (DISK_RE.test(key)) {
    const val = String(value ?? '')
    if (val.includes('media=cdrom') || val === 'cdrom') return PERMISSIONS.VM_CONFIG_MEDIA
    return PERMISSIONS.VM_CONFIG_HARDWARE
  }

  if (NET_RE.test(key)) {
    if (currentConfig && isLinkOnlyChange(key, value, currentConfig)) {
      return PERMISSIONS.VM_CONFIG_NIC_LINK
    }
    return PERMISSIONS.VM_CONFIG_NIC
  }

  if (BOOT_KEYS.has(key)) return PERMISSIONS.VM_CONFIG_BOOT
  if (CPU_KEYS.has(key)) return PERMISSIONS.VM_CONFIG_HARDWARE
  if (MEMORY_KEYS.has(key)) return PERMISSIONS.VM_CONFIG_HARDWARE
  if (HARDWARE_SCALAR_KEYS.has(key)) return PERMISSIONS.VM_CONFIG_HARDWARE
  if (HARDWARE_INDEXED_RE.test(key)) return PERMISSIONS.VM_CONFIG_HARDWARE
  if (key === 'rng0') return PERMISSIONS.VM_CONFIG_HARDWARE

  return PERMISSIONS.VM_CONFIG
}

export function classifyConfigBody(
  body: Record<string, unknown>,
  currentConfig?: Record<string, unknown>,
): Set<string> {
  const required = new Set<string>()

  const deleteStr = typeof body.delete === 'string' ? body.delete : ''
  const revertStr = typeof body.revert === 'string' ? body.revert : ''

  for (const key of Object.keys(body)) {
    if (key === 'delete' || key === 'revert') continue
    required.add(classifyConfigKey(key, body[key], currentConfig))
  }

  for (const raw of [deleteStr, revertStr]) {
    for (const k of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      required.add(classifyConfigKey(k, currentConfig?.[k], currentConfig))
    }
  }

  return required
}
