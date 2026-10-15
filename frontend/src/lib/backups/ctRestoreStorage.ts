import { pveFetch } from '@/lib/proxmox/client'
import { safeLog } from '@/lib/log/sanitize'

// Target storage of a container restore when the caller did not pick one.
//
// A VM restored without `storage` puts each disk back on the storage it came
// from. A container does not: `pct restore` (POST /nodes/{node}/lxc) defaults
// `storage` to 'local' and creates EVERY volume there, whatever the backup
// held. 'local' is a plain directory storage that usually does not carry the
// `rootdir` content, so the call dies with "storage 'local' does not support
// container directories", and when it does carry it the container silently
// lands on the node's root disk.
//
// "Default storage" in every restore dialog therefore means what it means for
// a VM: the storage the container's rootfs was on, read from the backed-up
// config. When that storage is not usable for containers on the target node
// (or the config cannot be read), the restore is refused up front with a
// message that asks for a target storage, instead of a request PVE rejects.

export type CtRestoreStorage = { storage: string } | { error: string }

/** Storage id of the backed-up rootfs volume, null for a bind mount or none. */
export function rootfsStorageOf(config: string): string | null {
  const m = /^rootfs:\s*([^,\s]+)/m.exec(config || '')
  if (!m) return null
  const volume = m[1]
  if (volume.startsWith('/')) return null
  const colon = volume.indexOf(':')
  return colon > 0 ? volume.slice(0, colon) : null
}

export async function resolveCtRestoreStorage(
  conn: Parameters<typeof pveFetch>[0],
  node: string,
  archive: string,
): Promise<CtRestoreStorage> {
  const nodePath = `/nodes/${encodeURIComponent(node)}`

  let original: string | null = null
  try {
    const config = await pveFetch<string>(conn, `${nodePath}/vzdump/extractconfig?volume=${encodeURIComponent(archive)}`)
    original = rootfsStorageOf(typeof config === 'string' ? config : '')
  } catch (err: any) {
    console.error(`[restore] could not read the container backup config: ${safeLog(err?.message ?? err)}`)
  }
  if (!original) {
    return { error: 'Choose a target storage: the original storage of this container backup could not be determined.' }
  }

  let usable: string[] = []
  try {
    const list = await pveFetch<any[]>(conn, `${nodePath}/storage?content=rootdir&enabled=1`)
    usable = (Array.isArray(list) ? list : []).map(s => String(s?.storage || '')).filter(Boolean)
  } catch (err: any) {
    console.error(`[restore] could not list container storages on ${safeLog(node)}: ${safeLog(err?.message ?? err)}`)
  }
  if (!usable.includes(original)) {
    return { error: `Choose a target storage: "${original}", where this container was backed up from, is not available for containers on node "${node}".` }
  }

  return { storage: original }
}
