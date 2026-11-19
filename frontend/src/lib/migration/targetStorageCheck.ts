// Reads what targetStoragePlan() needs from PVE for one guest (#1402).
//
// Server-only: it goes through pveFetch. The migrate dialog reaches it through
// GET .../migrate/storage-check, and POST .../migrate runs it as a guard so no
// caller is told "migration started" for a target storage PVE will drop.
//
// PVE load: five GETs, and only when a target storage is asked for.

import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'
import { targetStoragePlan, type TargetStorageFacts, type TargetStoragePlan } from './targetStoragePlan'

type GuestRef = { node: string; type: 'qemu' | 'lxc'; vmid: string }

function indexStorages(list: unknown): Record<string, TargetStorageFacts> {
  const storages: Record<string, TargetStorageFacts> = {}
  for (const s of Array.isArray(list) ? list : []) {
    if (s?.storage) storages[s.storage] = s
  }
  return storages
}

export async function checkTargetStorage(
  conn: ProxmoxClientOptions,
  guest: GuestRef,
  opts: { target: string; targetStorage?: string },
): Promise<TargetStoragePlan> {
  if (!opts.targetStorage) return { kind: 'direct' }

  const base = `/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${encodeURIComponent(guest.vmid)}`
  const sid = `${guest.type === 'lxc' ? 'ct' : 'vm'}:${guest.vmid}`

  const [config, storageList, haResources, jobs, status] = await Promise.all([
    pveFetch<Record<string, unknown>>(conn, `${base}/config`),
    pveFetch<unknown[]>(conn, '/storage'),
    pveFetch<Array<{ sid?: string }>>(conn, '/cluster/ha/resources'),
    pveFetch<Array<{ guest?: string | number; target?: string }>>(conn, '/cluster/replication'),
    pveFetch<{ status?: string }>(conn, `${base}/status/current`),
  ])

  return targetStoragePlan({
    guestType: guest.type,
    running: status?.status === 'running',
    sourceNode: guest.node,
    targetNode: opts.target,
    targetStorage: opts.targetStorage,
    config: config ?? {},
    storages: indexStorages(storageList),
    haManaged: (Array.isArray(haResources) ? haResources : []).some(r => r?.sid === sid),
    replicationTargets: (Array.isArray(jobs) ? jobs : [])
      .filter(job => String(job?.guest) === String(guest.vmid) && job?.target)
      .map(job => String(job.target)),
  })
}
