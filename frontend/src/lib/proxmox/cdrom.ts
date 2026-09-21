/** Optical drive detection and media swaps on PVE drive strings. */

type OpticalDrive = { head: string; opts: Array<[string, string]> }

// A mounted medium is an ISO on a storage, or nothing. Property separators are
// refused in the name because the string is rebuilt with them.
const OPTICAL_MEDIA_RE = /^[A-Za-z][A-Za-z0-9._-]*:iso\/[^,=;\\]+$/
// Same shape as inventory/helpers.ts: PVE names the cloud-init drive
// vm-<vmid>-cloudinit. A plain ISO called cloudinit.iso is ordinary media.
const CLOUD_INIT_RE = /(?:^|[:/])vm-\d+-cloudinit(?:\.\w+)?$/

/**
 * Lenient split of a drive string. The tenant scope validator (lib/vdc/drives)
 * keeps its strict volume charset; this only has to tell an optical drive from
 * the rest, so an ISO named with '&', quotes or accents stays editable for
 * whoever PVE let mount it. Media changes never create, remove or reconfigure
 * the optical device itself.
 */
function opticalDrive(raw: unknown): OpticalDrive | null {
  if (typeof raw !== 'string' || !raw) return null
  if (raw === 'cdrom') return { head: 'cdrom', opts: [] }
  const [head, ...rest] = raw.split(',')
  if (!head || head.includes('=') || head.split('/').includes('..')) return null
  const opts: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const part of rest) {
    const eq = part.indexOf('=')
    const key = eq < 0 ? part : part.slice(0, eq)
    if (!key || seen.has(key)) return null
    seen.add(key)
    opts.push([key, eq < 0 ? '' : part.slice(eq + 1)])
  }
  if (!opts.some(([key, value]) => key === 'media' && value === 'cdrom')) return null
  if (CLOUD_INIT_RE.test(head)) return null
  return { head, opts }
}

/** True for a bus slot that currently carries (or would carry) an optical drive. */
export function isOpticalDrive(raw: unknown): boolean {
  return opticalDrive(raw) !== null
}

function isIsoOrEmpty(head: string): boolean {
  return head === 'none' || (OPTICAL_MEDIA_RE.test(head) && !head.split('/').includes('..'))
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
  if (!isIsoOrEmpty(volume)) throw new Error('Invalid CD/DVD medium')
  const options = before.opts.filter(([key]) => key !== 'media' && key !== 'size')
  return [volume, 'media=cdrom', ...options.map(([key, value]) => `${key}=${value}`)].join(',')
}
