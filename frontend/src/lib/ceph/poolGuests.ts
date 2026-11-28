import { pveFetch } from '@/lib/proxmox/client'

/*
   The guest disks still on a Ceph pool, read before the pool is deleted
   (ui#1450): the RBD storages of the cluster that use the pool, then the
   images and container volumes of each. A storage whose content cannot be
   read is reported apart, so the caller can refuse instead of guessing.

   Only this cluster's storages are read: another PVE cluster consuming the
   same Ceph as an external RBD storage is not seen (the dialog says so).
*/

export interface PoolGuestDisks {
  storages: string[]
  disks: string[]
  unreadable: string[]
}

const GUEST_CONTENT = new Set(['images', 'rootdir'])

/** The RBD storages of `/storage` on `pool`: PVE names the pool after the storage when `pool` is absent. */
export function poolStorages(storages: unknown, pool: string): string[] {
  const rows = Array.isArray(storages) ? storages : []
  return rows
    .filter((s: any) => s?.type === 'rbd' && typeof s.storage === 'string' && (s.pool ?? s.storage) === pool)
    .map((s: any) => s.storage as string)
}

export async function findPoolGuestDisks(conn: any, viaNode: string, pool: string): Promise<PoolGuestDisks> {
  const storages = poolStorages(await pveFetch<any[]>(conn, '/storage'), pool)
  const disks: string[] = []
  const unreadable: string[] = []

  for (const storage of storages) {
    try {
      const content = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(viaNode)}/storage/${encodeURIComponent(storage)}/content`)
      for (const v of Array.isArray(content) ? content : []) {
        if (GUEST_CONTENT.has(v?.content) && typeof v.volid === 'string') disks.push(v.volid)
      }
    } catch {
      unreadable.push(storage)
    }
  }

  return { storages, disks, unreadable }
}
