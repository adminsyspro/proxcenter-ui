/**
 * Register a freshly created guest as a Proxmox HA resource (#181).
 *
 * Used by the template deploy pipeline and by the clone route, which both
 * create a guest and can now hand it to the HA manager in the same action.
 * The rules mirror the HA tab (`/api/v1/connections/[id]/ha/[sid]`):
 * `node.manage` on the connection and the provider tenant only. On top of
 * that every disk must sit on shared storage: an HA guest on local storage
 * cannot be recovered on another node, and relocating it would move a guest
 * that must not move.
 */

import { pveFetch } from '@/lib/proxmox/client'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

type Conn = Parameters<typeof pveFetch>[0]

export const HA_LOCAL_STORAGE_ERROR = 'High availability needs every disk on shared storage.'

/** 403 response when the caller may not manage HA on this connection, null otherwise. */
export async function haPermissionDenied(connectionId: string): Promise<Response | null> {
  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, 'connection', connectionId)
  if (denied) return denied
  return requireProviderTenant()
}

/**
 * Storage ids named by the drives of a guest config (`storage:volume,...`):
 * VM disks, EFI and TPM state, a container's rootfs and mount points. Cdroms,
 * `none` and bind mounts (a host path, no storage) are left out.
 */
export function driveStoragesOf(config: Record<string, unknown> | null | undefined): string[] {
  const out = new Set<string>()
  for (const [key, value] of Object.entries(config || {})) {
    if (!/^((scsi|sata|virtio|ide|efidisk|tpmstate|mp)\d+|rootfs)$/.test(key) || typeof value !== 'string') continue
    if (/(^|,)media=cdrom(,|$)/.test(value)) continue
    const volume = value.split(',')[0]
    const sep = volume.indexOf(':')
    if (sep > 0) out.add(volume.slice(0, sep))
  }
  return [...out]
}

/** The storages among `storages` that are not shared (unknown ones count as not shared). */
export async function nonSharedStorages(conn: Conn, storages: string[]): Promise<string[]> {
  const unique = [...new Set(storages)]
  const configs = await Promise.all(unique.map(storage =>
    pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`).catch(() => null)))
  return unique.filter((_, i) => !configs[i] || !isSharedStorage(configs[i]))
}

/**
 * Add the guest to the HA manager (`vm:<vmid>`, or `ct:<vmid>` for a
 * container). `started` hands it to HA right away (HA starts it); `stopped`
 * registers it and keeps it off, for an ISO install that waits for the user.
 */
export async function registerHaResource(
  conn: Conn,
  vmid: number | string,
  state: 'started' | 'stopped',
  guestType: 'qemu' | 'lxc' = 'qemu',
): Promise<void> {
  const params = new URLSearchParams({ sid: `${guestType === 'lxc' ? 'ct' : 'vm'}:${vmid}`, state })
  await pveFetch<any>(conn, '/cluster/ha/resources', {
    method: 'POST',
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}
