/** Sensitive NIC identity rights are intentionally not inherited from vm.config. */
export const SENSITIVE_NIC_PERMISSIONS = ['vm.config.nic.mac', 'vm.config.nic.vlan'] as const

const MODELS = new Set(['e1000', 'e1000-82540em', 'e1000-82544gc', 'e1000-82545em', 'e1000e', 'i82551', 'i82557b', 'i82559er', 'ne2k_isa', 'ne2k_pci', 'pcnet', 'rtl8139', 'virtio', 'vmxnet3'])
export const QEMU_NIC_MODELS: ReadonlySet<string> = MODELS
const NET = /^net\d+$/

export class NicConfigError extends Error {}

/** Canonicalize PVE's equivalent model=MAC, model,macaddr=MAC and LXC spellings. */
export function normalizedNicProperties(raw: unknown): Map<string, string> {
  const result = new Map<string, string>()
  const put = (key: string, value: string) => {
    if (result.has(key)) throw new NicConfigError(`Duplicate NIC property: ${key}`)
    result.set(key, value)
  }
  for (const part of String(raw ?? '').split(',').filter(Boolean)) {
    const eq = part.indexOf('=')
    const key = (eq < 0 ? part : part.slice(0, eq)).trim()
    const value = eq < 0 ? '' : part.slice(eq + 1).trim()
    if (MODELS.has(key)) {
      put('model', key)
      if (value) put('mac', value.replace(/[:-]/g, '').toUpperCase())
    } else if (key === 'macaddr' || key === 'hwaddr') {
      put('mac', value.replace(/[:-]/g, '').toUpperCase())
    } else if (key === 'tag') {
      if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 4094)) throw new NicConfigError('Invalid NIC VLAN tag')
      put(key, value ? String(Number(value)) : '')
    } else if (key === 'trunks') {
      const tags = value.split(';').filter(Boolean)
      if (tags.some(v => !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 4094)) throw new NicConfigError('Invalid NIC VLAN trunks')
      put(key, [...new Set(tags.map(v => String(Number(v))))].sort().join(';'))
    } else {
      put(key, value)
    }
  }
  return result
}

export function hasNicRevert(body: Record<string, unknown>): boolean {
  return typeof body.revert === 'string' && body.revert.split(',').some(k => NET.test(k.trim()))
}

export function hasNicMutation(body: Record<string, unknown>): boolean {
  return Object.keys(body).some(k => NET.test(k)) || hasNicRevert(body) ||
    (typeof body.delete === 'string' && body.delete.split(',').some(k => NET.test(k.trim())))
}

/** Whole-NIC deletion remains the ordinary NIC right. Replacing/resetting fields does not. */
export function sensitiveNicPermissions(
  body: Record<string, unknown>,
  effective: Record<string, unknown> = {},
  running?: Record<string, unknown>,
): string[] {
  const required = new Set<string>()
  const compare = (key: string, next: unknown) => {
    const before = normalizedNicProperties(effective[key])
    const after = normalizedNicProperties(next)
    if ((before.get('mac') || '') !== (after.get('mac') || '')) required.add(SENSITIVE_NIC_PERMISSIONS[0])
    if (['tag', 'trunks'].some(k => (before.get(k) || '') !== (after.get(k) || ''))) required.add(SENSITIVE_NIC_PERMISSIONS[1])
  }
  for (const [key, value] of Object.entries(body)) if (NET.test(key)) compare(key, value)
  if (hasNicRevert(body)) {
    if (!running) throw new NicConfigError('Current NIC configuration is required to revert pending changes')
    for (const key of String(body.revert).split(',').map(k => k.trim()).filter(k => NET.test(k))) compare(key, running[key])
  }
  return [...required]
}

export function roleHasSensitiveNicPermissions(role: { permissions?: { permissionId: string }[] }): boolean {
  return role.permissions?.some(p => (SENSITIVE_NIC_PERMISSIONS as readonly string[]).includes(p.permissionId)) ?? false
}
