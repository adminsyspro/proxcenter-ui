import { prisma } from '@/lib/db/prisma'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'

/**
 * Whether a guest delete may pass `destroy-unreferenced-disks=1` (ui#1460).
 *
 * With that flag PVE deletes every volume named after the VMID on every storage
 * the node sees, referenced or not. On a storage another cluster also reaches,
 * a guest of that cluster with the same VMID owns volumes of the same name:
 * measured on the lab, a delete on one cluster wiped the disk of the other
 * cluster's guest, and the source delete after a copy migration wiped the copy
 * the target had just imported under `vm-<vmid>-disk-1`.
 *
 * The flag is kept when no shared storage holds an unreferenced volume of this
 * VMID, or when no other managed PVE cluster has a guest with it. Otherwise the
 * delete goes without it: PVE still removes every disk the config references
 * (unusedN included), and the orphans are named back to the caller. When the
 * storages cannot be read and another cluster has this VMID, the disks stay
 * too: a leftover volume costs space, a deleted one costs the data.
 */
export type UnreferencedDiskDecision = {
  destroyUnreferenced: boolean
  /** Unreferenced shared volumes left in place, empty when the check could not run. */
  keptVolumes: string[]
}

const keepUnverified = (): UnreferencedDiskDecision => ({ destroyUnreferenced: false, keptVolumes: [] })
const purge = (): UnreferencedDiskDecision => ({ destroyUnreferenced: true, keptVolumes: [] })

type StorageRow = { storage?: string; shared?: number | string; content?: string }
type ContentRow = { volid?: string; vmid?: number | string; content?: string }

const VOLID = /^[A-Za-z][\w.-]*:\S+$/

/** Volume ids a guest config points at: the part before the first comma of each value. */
export function referencedVolids(config: Record<string, unknown>): Set<string> {
  const refs = new Set<string>()
  for (const value of Object.values(config || {})) {
    if (typeof value !== 'string') continue
    const head = value.split(',')[0].trim()
    if (VOLID.test(head) && !head.includes('=')) refs.add(head)
  }
  return refs
}

function holdsGuestDisks(s: StorageRow): boolean {
  return Number(s.shared) === 1 && String(s.content || '').split(',').some(c => c === 'images' || c === 'rootdir')
}

/** A guest disk, not a backup, ISO or template the same storage lists for this VMID. */
function isGuestVolume(r: ContentRow): boolean {
  return r?.content === undefined || r.content === 'images' || r.content === 'rootdir'
}

function guestPath(node: string, type: 'qemu' | 'lxc', vmid: string): string {
  return `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}`
}

async function unreferencedSharedVolumes(
  conn: ProxmoxClientOptions, node: string, type: 'qemu' | 'lxc', vmid: string,
): Promise<string[]> {
  const n = encodeURIComponent(node)
  const storages = await pveFetch<StorageRow[]>(conn, `/nodes/${n}/storage?enabled=1`)
  const shared = (Array.isArray(storages) ? storages : []).filter(holdsGuestDisks)
  if (shared.length === 0) return []

  const config = await pveFetch<Record<string, unknown>>(conn, `${guestPath(node, type, vmid)}/config`)
  const referenced = referencedVolids(config)
  const listed = await Promise.all(shared.map(s =>
    pveFetch<ContentRow[]>(conn, `/nodes/${n}/storage/${encodeURIComponent(String(s.storage))}/content?vmid=${encodeURIComponent(vmid)}`),
  ))
  return listed.flatMap(rows => (Array.isArray(rows) ? rows : []))
    .filter(r => String(r?.vmid) === vmid && typeof r?.volid === 'string' && isGuestVolume(r) && !referenced.has(r.volid))
    .map(r => String(r.volid))
}

/**
 * Drops the volumes a snapshot of the guest references (RAM state, a disk
 * detached since): PVE deletes them with the guest, flag or not. Read only
 * once orphans remain; a failure leaves the list as it is.
 */
async function withoutSnapshotVolumes(
  conn: ProxmoxClientOptions, node: string, type: 'qemu' | 'lxc', vmid: string, orphans: string[],
): Promise<string[]> {
  try {
    const base = guestPath(node, type, vmid)
    const snapshots = await pveFetch<{ name?: string }[]>(conn, `${base}/snapshot`)
    const names = (Array.isArray(snapshots) ? snapshots : []).map(s => String(s?.name || '')).filter(n => n && n !== 'current')
    const configs = await Promise.all(names.map(name =>
      pveFetch<Record<string, unknown>>(conn, `${base}/snapshot/${encodeURIComponent(name)}/config`),
    ))
    const referenced = new Set(configs.flatMap(c => [...referencedVolids(c)]))
    return orphans.filter(v => !referenced.has(v))
  } catch {
    return orphans
  }
}

/** True when another managed PVE cluster has a guest with this VMID, or cannot be read. */
async function vmidOnAnotherCluster(connectionId: string | undefined, vmid: string): Promise<boolean> {
  const others = await prisma.connection.findMany({
    where: { type: 'pve', id: { not: connectionId ?? '' } },
    select: { id: true, tenantId: true },
  })
  const found = await Promise.all(others.map(async other => {
    try {
      // Explicit tenant: a safety read of the whole fleet, nothing of it is shown.
      const conn = await getConnectionById(other.id, other.tenantId)
      const guests = await pveFetch<{ vmid?: number | string }[]>(conn, '/cluster/resources?type=vm')
      return (Array.isArray(guests) ? guests : []).some(g => String(g?.vmid) === vmid)
    } catch {
      return true
    }
  }))
  return found.some(Boolean)
}

export async function decideUnreferencedDiskPurge(input: {
  conn: ProxmoxClientOptions
  /** The connection the guest is on; without it every other cluster still counts. */
  connectionId?: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: string | number
}): Promise<UnreferencedDiskDecision> {
  const vmid = String(input.vmid)
  const { conn, node, type } = input
  let orphans: string[] | null
  try {
    orphans = await unreferencedSharedVolumes(conn, node, type, vmid)
  } catch {
    orphans = null
  }
  if (orphans?.length === 0) return purge()

  // Asked only now: one read per other cluster, on the rare delete that
  // leaves a shared orphan or could not list the storages.
  let elsewhere: boolean
  try {
    elsewhere = await vmidOnAnotherCluster(input.connectionId ?? conn.id, vmid)
  } catch {
    elsewhere = true
  }
  if (!elsewhere) return purge()
  if (orphans === null) return keepUnverified()

  const kept = await withoutSnapshotVolumes(conn, node, type, vmid, orphans)
  return kept.length === 0 ? purge() : { destroyUnreferenced: false, keptVolumes: kept }
}

/** One English sentence for logs and API answers, empty when nothing was kept. */
export function keptVolumesNote(decision: UnreferencedDiskDecision | undefined): string {
  if (!decision || decision.destroyUnreferenced) return ''
  if (decision.keptVolumes.length === 0) return 'Unreferenced disks were kept: the shared storages could not be checked and another cluster runs a guest with this VMID.'
  return `Kept ${decision.keptVolumes.join(', ')}: another cluster runs a guest with this VMID and may use it.`
}
