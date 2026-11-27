import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'

/**
 * Guest identity of Proxmox VE 9.3: a `uid` kept in the `meta` property of a
 * VM or container config (`meta: creation-qemu=11.1.3,ctime=...,uid=p4l2...`).
 * A restore over an existing guest refuses a backup whose uid differs from the
 * guest's own unless `allow-identity-mismatch` is sent.
 */

/** The uid of a `meta` property string, null when it has none. */
export function guestUidFromMeta(meta: unknown): string | null {
  if (typeof meta !== 'string') return null
  for (const part of meta.split(',')) {
    const [key, value] = part.split('=', 2)
    if (key?.trim() === 'uid' && value?.trim()) return value.trim()
  }

  return null
}

/** The uid of the guest config inside a backup (`vzdump/extractconfig` text), current section only. */
export function guestUidFromArchiveConfig(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) break
    const m = /^meta:\s*(.*)$/.exec(line.trim())
    if (m) return guestUidFromMeta(m[1])
  }

  return null
}

export type IdentityMismatch = { backupUid: string; guestUid: string }

/**
 * Whether restoring `archive` over the guest `vmid` is a restore of another
 * guest's backup, read the way PVE 9.3 judges it: both carry a uid and they
 * differ. Null when they match, when either has no uid (PVE before 9.3, or a
 * backup taken before), or when a config cannot be read: PVE then decides on
 * its own, as before.
 */
export async function findIdentityMismatch(
  conn: ProxmoxClientOptions,
  restoreNode: string,
  archive: string,
  guest: { node: string; type: string; vmid: string | number },
): Promise<IdentityMismatch | null> {
  const endpoint = guest.type === 'lxc' ? 'lxc' : 'qemu'
  let guestUid: string | null = null
  try {
    const config = await pveFetch<Record<string, unknown>>(
      conn,
      `/nodes/${encodeURIComponent(guest.node)}/${endpoint}/${encodeURIComponent(String(guest.vmid))}/config`,
    )
    guestUid = guestUidFromMeta(config?.meta)
  } catch {
    return null
  }
  if (!guestUid) return null

  let backupUid: string | null = null
  try {
    const text = await pveFetch<unknown>(
      conn,
      `/nodes/${encodeURIComponent(restoreNode)}/vzdump/extractconfig?volume=${encodeURIComponent(archive)}`,
    )
    if (typeof text === 'string') backupUid = guestUidFromArchiveConfig(text)
  } catch {
    return null
  }
  if (!backupUid || backupUid === guestUid) return null

  return { backupUid, guestUid }
}
