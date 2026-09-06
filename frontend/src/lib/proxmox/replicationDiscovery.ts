import { NextResponse } from 'next/server'

import { getConnectionById, type PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import type { ReplicableVM, ReplicationStorages, StorageEngine } from '@/lib/orchestrator/site-recovery.types'
import { formatBytes } from '@/utils/format'

export interface ReplicationStorageConfig {
  storage: string
  type: string
  pool?: string
  content?: string
  disable?: number | boolean
  nodes?: string
}

export interface ReplicationResource {
  type: string
  node: string
  vmid?: number
  template?: number
  storage?: string
  plugintype?: string
  status?: string
  maxdisk?: number
  disk?: number
}

interface DiscoveryContext {
  conn: PveConn
  configs: ReplicationStorageConfig[]
  resources: ReplicationResource[]
}

// Sharing the permission and PVE reads keeps both discovery endpoints consistent.
export async function replicationDiscovery(
  ctx: { params: Promise<{ id: string }> },
  discover: (context: DiscoveryContext) => unknown | Promise<unknown>,
) {
  try {
    const { id } = await ctx.params
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', id)

    if (denied) return denied
    const conn = await getConnectionById(id)
    const [configs, resources] = await Promise.all([
      pveFetch<ReplicationStorageConfig[]>(conn, '/storage'),
      pveFetch<ReplicationResource[]>(conn, '/cluster/resources'),
    ])

    return NextResponse.json(await discover({ conn, configs: configs || [], resources: resources || [] }))
  } catch (error) {
    // An unavailable site must remain distinguishable from a site with no storage.
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export function discoverReplicationStorages(configs: ReplicationStorageConfig[], resources: ReplicationResource[]): ReplicationStorages {
  const result: ReplicationStorages = { engines: [], zfs: [], rbd: [] }

  for (const config of configs) {
    if (config.disable || !config.content?.split(',').includes('images')) continue
    if (config.type === 'rbd') {
      result.rbd.push({ storage: config.storage, pool: config.pool || config.storage })
    } else if (config.type === 'zfspool') {
      const nodes = config.nodes?.split(',').filter(Boolean)
      const rows = resources.filter(row => row.type === 'storage' && row.plugintype === 'zfspool'
        && row.storage === config.storage && (!nodes?.length || nodes.includes(row.node)))

      for (const row of rows) {
        const totalBytes = Number(row.maxdisk || 0)
        const availBytes = Math.max(0, totalBytes - Number(row.disk || 0))

        result.zfs.push({
          storage: config.storage, node: row.node, pool: config.pool || config.storage,
          availBytes, totalBytes, availFormatted: formatBytes(availBytes), active: row.status === 'available',
        })
      }
    }
  }
  if (result.rbd.length) result.engines.push('rbd')
  if (result.zfs.length) result.engines.push('zfs')

  return result
}

type DiskClassification = 'engine' | 'optout' | 'cdrom' | 'other' | 'unsupported'

export function classifyReplicationDisk(line: string, storages: Set<string>): DiskClassification {
  const [volume, ...options] = line.split(',')

  if (options.includes('replicate=0')) return 'optout'
  if (options.includes('media=cdrom')) return 'cdrom'
  if (!volume.includes(':')) return 'unsupported'

  return storages.has(volume.split(':')[0]) ? 'engine' : 'other'
}

function diskSizeGb(line: string): number {
  const size = line.split(',').find(option => option.startsWith('size='))?.slice(5)
  const match = size?.match(/^(\d+(?:\.\d+)?)([KMGT])?$/i)

  if (!match) return 0
  const factors: Record<string, number> = { K: 1 / 1024 ** 2, M: 1 / 1024, G: 1, T: 1024 }

  return Number(match[1]) * factors[(match[2] || 'G').toUpperCase()]
}

export function classifyReplicationVM(config: Record<string, unknown>, storages: Set<string>) {
  let engineDisks = 0
  let diskGb = 0
  let mixed = false
  let unsupported = false

  for (const [device, value] of Object.entries(config)) {
    if (!/^(virtio|scsi|sata|ide|efidisk|tpmstate)\d+$/.test(device)) continue
    const line = String(value)
    const kind = classifyReplicationDisk(line, storages)

    if (kind === 'engine') {
      engineDisks++
      diskGb += diskSizeGb(line)
    }
    if (kind === 'other') mixed = true
    if (kind === 'unsupported') unsupported = true
  }

  return engineDisks ? { diskGb: Math.round(diskGb * 10) / 10, mixed, unsupported } : null
}

export async function discoverReplicableVMs({ conn, configs, resources }: DiscoveryContext, engine: StorageEngine): Promise<ReplicableVM[]> {
  const storages = new Set(configs.filter(config => config.type === (engine === 'zfs' ? 'zfspool' : 'rbd')).map(config => config.storage))

  if (!storages.size) return []
  const guests = resources.filter(vm => vm.type === 'qemu' && vm.template !== 1 && vm.vmid !== undefined)
  const results = await Promise.all(guests.map(async vm => {
    const config = await pveFetch<Record<string, unknown>>(conn, `/nodes/${encodeURIComponent(vm.node)}/qemu/${vm.vmid}/config`)
    const disks = classifyReplicationVM(config, storages)

    return disks ? { vmid: vm.vmid!, node: vm.node, ...disks } : null
  }))

  return results.filter((vm): vm is ReplicableVM => vm !== null)
}
