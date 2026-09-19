import { parseDriveString } from '@/lib/vdc/drives'

/** Media changes never create, remove or reconfigure the optical device itself. */
function opticalDrive(raw: unknown) {
  if (typeof raw !== 'string') return null
  if (raw === 'cdrom') return { head: 'cdrom', opts: [] as Array<[string, string]> }
  const parsed = parseDriveString(raw)
  if (!parsed.ok || !parsed.drive.isCdrom) return null
  if (/(?:^|[:/])(?:vm-\d+-)?cloudinit(?:\.\w+)?$/.test(parsed.drive.head)) return null
  return parsed.drive
}

function isIsoOrEmpty(head: string): boolean {
  return head === 'none' || /^[A-Za-z][A-Za-z0-9._-]*:iso\/.+/.test(head)
}

export function isCdromMediaChange(beforeValue: unknown, afterValue: unknown): boolean {
  const before = opticalDrive(beforeValue)
  const after = opticalDrive(afterValue)
  if (!before || !after || !isIsoOrEmpty(after.head)) return false
  const oldOptions = new Map(before.opts)
  const newOptions = new Map(after.opts)
  // An import can allocate storage even when a caller labels it media=cdrom.
  if (newOptions.has('import-from')) return false
  for (const key of new Set([...oldOptions.keys(), ...newOptions.keys()])) {
    if (key === 'media') continue
    // PVE calculates ISO size from the selected file. Omitting its old size
    // on replacement/ejection is not a request to resize the drive.
    if (key === 'size' && !newOptions.has(key)) continue
    if (oldOptions.get(key) !== newOptions.get(key)) return false
  }
  return true
}

/** Preserve device options when the ISO picker changes only the mounted medium. */
export function replaceCdromMedia(raw: string, volume: string): string {
  const before = opticalDrive(raw)
  if (!before) throw new Error('An existing CD/DVD drive is required')
  const candidate = parseDriveString(`${volume},media=cdrom`)
  if (!candidate.ok || !isIsoOrEmpty(candidate.drive.head)) throw new Error('Invalid CD/DVD medium')
  const options = before.opts.filter(([key]) => key !== 'media' && key !== 'size')
  return [volume, 'media=cdrom', ...options.map(([key, value]) => `${key}=${value}`)].join(',')
}
