/**
 * Guest hardware tools (#459).
 *
 * Two questions the issue asks and the snapshot alone cannot answer well:
 * "which VM has the most vCPUs / memory / consumed space?" (a ranking over
 * data already gathered) and "how is this guest actually built?" (a config
 * read against Proxmox).
 *
 * Consumed space is the reason the second tool exists at all: for a qemu guest
 * Proxmox reports `maxdisk`, which is the PROVISIONED size, and a `disk` value
 * that is almost always 0. The only real figure comes from the guest agent, so
 * when the agent cannot answer the payload says so rather than letting the
 * model pass an allocation off as consumption.
 *
 * Both tools are read-only and go through the resolvers in `./types`, which
 * look every model-supplied reference up in the RBAC-filtered snapshot before
 * any Proxmox path is built.
 */

import type { AiGuest } from '@/lib/ai/context'
import type { AiTool, AiToolContext } from '@/lib/ai/tools/types'
import { argEnum, argNumber, argString, resolveConnection, resolveGuest } from '@/lib/ai/tools/types'
import { getConnectionById } from '@/lib/connections/getConnection'
import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const BYTES_PER_GB = 1024 * 1024 * 1024

/* ------------------------------------------------------------------ */
/* Shared coercion                                                    */
/* ------------------------------------------------------------------ */

function toNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined

  const value = Number(raw)

  return Number.isFinite(value) ? value : undefined
}

function toStr(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined

  const value = String(raw).trim()

  return value ? value : undefined
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

function usedPercent(used: number, total: number): number {
  if (!total || total <= 0) return 0

  return round((used / total) * 100, 1)
}

/* ------------------------------------------------------------------ */
/* Tool 1: rank_guest_hardware                                        */
/* ------------------------------------------------------------------ */

const RANK_METRICS = ['vcpus', 'memory', 'disk'] as const
const STATUS_FILTERS = ['all', 'running', 'stopped'] as const

type RankMetric = (typeof RANK_METRICS)[number]

const RANK_UNITS: Record<RankMetric, string> = {
  vcpus: 'vCPU',
  memory: 'GB',
  disk: 'GB',
}

const DISK_RANK_NOTE =
  'diskGb is the disk PROVISIONED in Proxmox, not the space used inside the guest. For real consumption call get_guest_hardware on a specific guest.'

/**
 * The value being ranked, or `undefined` when Proxmox did not report it.
 *
 * The snapshot collapses a missing byte count to 0, so a non-positive value
 * here means "not reported" rather than a guest genuinely sized at zero. A VM
 * with no memory does not exist; a VM whose memory we never received does.
 */
function rankedValue(guest: AiGuest, metric: RankMetric): number | undefined {
  let raw: number | undefined

  if (metric === 'vcpus') raw = guest.vcpus
  else if (metric === 'memory') raw = guest.memTotalGb
  else raw = guest.diskTotalGb

  return typeof raw === 'number' && raw > 0 ? raw : undefined
}

export const rankGuestHardwareTool: AiTool = {
  name: 'rank_guest_hardware',
  description:
    'Rank the VMs and containers you can see by the hardware ASSIGNED to them: vCPUs, memory, or provisioned disk. Answers "which VM has the most vCPUs", "which VM has the most memory", "which VM has the biggest disk". Templates are excluded. Example: metric=\'vcpus\', limit=5 or metric=\'memory\', status=\'running\'.',
  parameters: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        description: 'What to rank on: vcpus, memory (assigned RAM), or disk (provisioned disk).',
        enum: [...RANK_METRICS],
        default: 'vcpus',
      },
      limit: {
        type: 'integer',
        description: 'How many guests to return, highest first.',
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      status: {
        type: 'string',
        description: 'Restrict to running or stopped guests. Default all.',
        enum: [...STATUS_FILTERS],
        default: 'all',
      },
      cluster: {
        type: 'string',
        description: 'Cluster name to restrict to. Omit to rank across every visible cluster.',
      },
    },
  },
  async execute(args: Record<string, unknown>, ctx: AiToolContext) {
    const metric = argEnum(args, 'metric', RANK_METRICS, 'vcpus')
    const limit = argNumber(args, 'limit', 10, { min: 1, max: 50 })
    const status = argEnum(args, 'status', STATUS_FILTERS, 'all')
    const clusterRef = argString(args, 'cluster')

    // Resolved only when asked for: with no argument `resolveConnection` would
    // demand a cluster name on a multi-cluster estate, and ranking across all
    // of them is the sensible default here.
    const connection = clusterRef ? resolveConnection(ctx, clusterRef) : null

    const population = ctx.snapshot.guests.filter(guest => {
      if (guest.template) return false
      if (connection && guest.connId !== connection.id) return false
      if (status === 'running') return guest.status === 'running'
      if (status === 'stopped') return guest.status !== 'running'

      return true
    })

    const scored: { guest: AiGuest; value: number }[] = []
    let missingMetric = 0

    for (const guest of population) {
      const value = rankedValue(guest, metric)

      if (value === undefined) {
        missingMetric++
        continue
      }

      scored.push({ guest, value })
    }

    scored.sort((a, b) => b.value - a.value)

    return {
      metric,
      unit: RANK_UNITS[metric],
      statusFilter: status,
      cluster: connection ? connection.name : undefined,
      totalConsidered: population.length,
      /** Guests dropped because Proxmox never reported the ranked metric. */
      missingMetric,
      ranking: scored.slice(0, limit).map((entry, index) => ({
        rank: index + 1,
        name: entry.guest.name,
        vmid: entry.guest.vmid,
        type: entry.guest.type,
        node: entry.guest.node,
        cluster: entry.guest.cluster,
        vcpus: entry.guest.vcpus,
        memoryGb: entry.guest.memTotalGb,
        diskGb: entry.guest.diskTotalGb,
      })),
      note: metric === 'disk' ? DISK_RANK_NOTE : undefined,
    }
  },
}

/* ------------------------------------------------------------------ */
/* Tool 2: get_guest_hardware                                         */
/* ------------------------------------------------------------------ */

/** qemu disk keys, lxc rootfs and lxc mount points. */
const DISK_KEY_REGEX = /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$|^rootfs$|^mp\d+$/
const NET_KEY_REGEX = /^net\d+$/
const CDROM_REGEX = /\bmedia=cdrom\b/
const SIZE_REGEX = /\bsize=(\d+(?:\.\d+)?)([KMGT])/i
const TAG_REGEX = /\btag=(\d+)/
const MTU_REGEX = /\bmtu=(\d+)/

const UNIT_TO_GB: Record<string, number> = {
  K: 1 / (1024 * 1024),
  M: 1 / 1024,
  G: 1,
  T: 1024,
}

/** NIC model tokens PVE pins a MAC to, as in `virtio=BC:24:11:AA:BB:CC`. */
const NET_MODEL_TOKENS = new Set([
  'virtio',
  'e1000',
  'e1000-82540em',
  'e1000-82544gc',
  'e1000-82545em',
  'rtl8139',
  'vmxnet3',
])

/**
 * Pseudo filesystems the guest agent reports alongside the real ones.
 *
 * They must be dropped before summing: `tmpfs` inflates the total with RAM,
 * and an `overlay` on a container host double counts the disk it sits on.
 */
const VIRTUAL_FS_TYPES = new Set([
  'tmpfs',
  'devtmpfs',
  'overlay',
  'squashfs',
  'iso9660',
  'ramfs',
  'proc',
  'sysfs',
  'devfs',
  'autofs',
  'nsfs',
  'tracefs',
  'debugfs',
  'mqueue',
  'hugetlbfs',
  'pstore',
  'bpf',
  'securityfs',
  'configfs',
])

const VIRTUAL_FS_PREFIXES = ['fuse.', 'cgroup']

const NO_CONSUMPTION_NOTE =
  'Real consumed space is unavailable for this guest. Do NOT present provisionedDiskGb or the disk figures from the snapshot as consumption: they are the allocated size, and Proxmox reports 0 used for a VM without a guest agent.'

type GuestDisk = {
  key: string
  storage?: string
  sizeGb?: number
  raw: string
}

type GuestNic = {
  key: string
  model?: string
  mac?: string
  bridge?: string
  vlanTag?: number
  mtu?: number
}

type ConsumedSpace = {
  available: boolean
  reason?: 'guest-not-running' | 'agent-unavailable' | 'no-data'
  usedGb?: number
  totalGb?: number
  usedPct?: number
  source?: 'guest-agent' | 'proxmox'
}

type QemuFsInfo = {
  result?: {
    name?: string
    mountpoint?: string
    type?: string
    'total-bytes'?: number
    'used-bytes'?: number
  }[]
}

function isVirtualFs(type: unknown): boolean {
  const value = String(type || '').toLowerCase()

  if (!value) return false
  if (VIRTUAL_FS_TYPES.has(value)) return true

  return VIRTUAL_FS_PREFIXES.some(prefix => value.startsWith(prefix))
}

/** `agent` is either a bare flag (`1`) or a property list (`enabled=1,...`). */
function parseAgentEnabled(raw: unknown): boolean {
  const value = toStr(raw)

  if (!value) return false

  const enabled = /(?:^|,)enabled=([01])/.exec(value)

  if (enabled) return enabled[1] === '1'

  return value.split(',')[0].trim() === '1'
}

function parseSizeGb(raw: string): number | undefined {
  const match = SIZE_REGEX.exec(raw)

  if (!match) return undefined

  const value = Number.parseFloat(match[1])
  const factor = UNIT_TO_GB[match[2].toUpperCase()]

  if (!Number.isFinite(value) || !factor) return undefined

  return round(value * factor)
}

/** `local-lvm:vm-100-disk-0,size=32G` gives `local-lvm`. */
function parseStorage(raw: string): string | undefined {
  const head = raw.split(',')[0]
  const colon = head.indexOf(':')

  if (colon <= 0) return undefined

  return head.slice(0, colon)
}

function parseDisks(config: Record<string, unknown>): { disks: GuestDisk[]; provisionedDiskGb: number } {
  const disks: GuestDisk[] = []
  let provisioned = 0

  for (const [key, value] of Object.entries(config)) {
    if (!DISK_KEY_REGEX.test(key)) continue
    if (typeof value !== 'string') continue
    // A cdrom drive occupies a disk key but allocates nothing.
    if (CDROM_REGEX.test(value)) continue

    const sizeGb = parseSizeGb(value)

    // An unparsable size leaves sizeGb absent and out of the total, so the
    // model reads an incomplete sum rather than one silently short by a disk.
    if (sizeGb !== undefined) provisioned += sizeGb

    disks.push({ key, storage: parseStorage(value), sizeGb, raw: value })
  }

  disks.sort((a, b) => a.key.localeCompare(b.key))

  return { disks, provisionedDiskGb: round(provisioned) }
}

/**
 * Parse a `netN` line for either guest kind.
 *
 * qemu writes `virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=10` and accepts the
 * alternate `virtio,bridge=vmbr0,macaddr=...` the UI produces; lxc writes
 * `name=eth0,bridge=vmbr0,hwaddr=...,type=veth`. The MAC pinned to the model
 * token wins when both forms are present.
 */
function parseNic(key: string, raw: string): GuestNic {
  let model: string | undefined
  let name: string | undefined
  let modelMac: string | undefined
  let altMac: string | undefined
  let bridge: string | undefined

  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    const token = (eq < 0 ? part : part.slice(0, eq)).trim()
    const value = eq < 0 ? '' : part.slice(eq + 1).trim()

    if (NET_MODEL_TOKENS.has(token.toLowerCase())) {
      model = token
      if (value) modelMac = value.toUpperCase()
    } else if (token === 'macaddr' || token === 'hwaddr') {
      altMac = value.toUpperCase()
    } else if (token === 'bridge') {
      bridge = value
    } else if (token === 'name') {
      name = value
    }
  }

  const tag = TAG_REGEX.exec(raw)
  const mtu = MTU_REGEX.exec(raw)

  return {
    key,
    model: model || name,
    mac: modelMac || altMac,
    bridge,
    vlanTag: tag ? Number.parseInt(tag[1], 10) : undefined,
    mtu: mtu ? Number.parseInt(mtu[1], 10) : undefined,
  }
}

function parseNics(config: Record<string, unknown>): GuestNic[] {
  const nics: GuestNic[] = []

  for (const [key, value] of Object.entries(config)) {
    if (!NET_KEY_REGEX.test(key)) continue
    if (typeof value !== 'string') continue

    nics.push(parseNic(key, value))
  }

  nics.sort((a, b) => a.key.localeCompare(b.key))

  return nics
}

/**
 * Sum the real filesystems the qemu guest agent reports.
 *
 * Returns null when nothing usable came back: an agent that answers without
 * byte counts (older qemu-guest-agent) must read as "unknown", never as 0.
 */
async function readAgentConsumedSpace(
  conn: PveConn,
  node: string,
  vmid: string
): Promise<{ usedGb: number; totalGb: number } | null> {
  const info = await pveFetch<QemuFsInfo>(
    conn,
    `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/agent/get-fsinfo`,
    {},
    // Shorter than the default: a wedged agent must not hold up a chat turn.
    { timeoutMs: 5_000 }
  )

  const filesystems = Array.isArray(info?.result) ? info.result : []
  const seen = new Set<string>()
  let usedBytes = 0
  let totalBytes = 0

  for (const fs of filesystems) {
    if (isVirtualFs(fs?.type)) continue

    const total = Number(fs?.['total-bytes'])
    const used = Number(fs?.['used-bytes'])

    if (!Number.isFinite(total) || total <= 0) continue
    if (!Number.isFinite(used) || used < 0) continue

    // Bind mounts and btrfs subvolumes report the same device several times;
    // counting each one would multiply the size of the guest.
    const identity = String(fs?.name || fs?.mountpoint || '')

    if (identity) {
      if (seen.has(identity)) continue
      seen.add(identity)
    }

    totalBytes += total
    usedBytes += used
  }

  if (totalBytes <= 0) return null

  return { usedGb: round(usedBytes / BYTES_PER_GB), totalGb: round(totalBytes / BYTES_PER_GB) }
}

/** Best effort by design: a missing agent is a normal answer, not an error. */
async function resolveConsumedSpace(guest: AiGuest, conn: PveConn): Promise<ConsumedSpace> {
  if (guest.status !== 'running') {
    return { available: false, reason: 'guest-not-running' }
  }

  try {
    // A container has no agent, but Proxmox's own `disk` figure is real for
    // lxc, unlike for qemu.
    if (guest.kind === 'lxc') {
      const usedGb = guest.diskUsedGb
      const totalGb = guest.diskTotalGb

      if (!usedGb || !totalGb) return { available: false, reason: 'no-data' }

      return {
        available: true,
        usedGb,
        totalGb,
        usedPct: usedPercent(usedGb, totalGb),
        source: 'proxmox',
      }
    }

    const measured = await readAgentConsumedSpace(conn, guest.node, guest.vmid)

    if (!measured) return { available: false, reason: 'agent-unavailable' }

    return {
      available: true,
      usedGb: measured.usedGb,
      totalGb: measured.totalGb,
      usedPct: usedPercent(measured.usedGb, measured.totalGb),
      source: 'guest-agent',
    }
  } catch {
    return { available: false, reason: 'agent-unavailable' }
  }
}

export const getGuestHardwareTool: AiTool = {
  name: 'get_guest_hardware',
  description:
    'Full hardware sheet for ONE VM or container: cores, sockets, vCPUs, CPU type, memory, BIOS, every disk with its size and storage, every network interface with its bridge, VLAN and MAC, and the space really consumed inside the guest when its agent answers. Answers "how is this VM configured" and "how much space does it really use". Example: guest=\'db-01\' or guest=\'104\'.',
  parameters: {
    type: 'object',
    properties: {
      guest: {
        type: 'string',
        description: 'The VM or container, by exact name or by vmid.',
      },
    },
    required: ['guest'],
  },
  async execute(args: Record<string, unknown>, ctx: AiToolContext) {
    // The security gate: resolves against the caller's own snapshot, so no
    // Proxmox path is ever built from a reference outside their perimeter.
    const guest = resolveGuest(ctx, argString(args, 'guest'))

    const conn = await getConnectionById(guest.connId, ctx.tenantId)
    const config = await pveFetch<Record<string, unknown>>(
      conn,
      `/nodes/${encodeURIComponent(guest.node)}/${encodeURIComponent(guest.kind)}/${encodeURIComponent(guest.vmid)}/config`
    )

    const cores = toNumber(config.cores)
    // PVE defaults sockets to 1. An lxc with no `cores` is NOT limited to one
    // core, it is unlimited, so vcpus stays unknown instead of reading as 1.
    const sockets = toNumber(config.sockets) ?? 1
    const { disks, provisionedDiskGb } = parseDisks(config)
    const networkInterfaces = parseNics(config)
    const consumedSpace = await resolveConsumedSpace(guest, conn)

    return {
      guest: {
        name: guest.name,
        vmid: guest.vmid,
        type: guest.type,
        node: guest.node,
        cluster: guest.cluster,
        status: guest.status,
        template: guest.template,
      },
      cpu: {
        cores,
        sockets,
        vcpus: cores === undefined ? undefined : cores * sockets,
        cpuType: toStr(config.cpu),
        numa: toNumber(config.numa) === 1,
      },
      memoryMb: toNumber(config.memory),
      balloonMb: toNumber(config.balloon),
      bios: toStr(config.bios),
      ostype: toStr(config.ostype),
      agentEnabled: parseAgentEnabled(config.agent),
      machine: toStr(config.machine),
      disks,
      provisionedDiskGb,
      networkInterfaces,
      interfaceCount: networkInterfaces.length,
      consumedSpace,
      note: consumedSpace.available ? undefined : NO_CONSUMPTION_NOTE,
    }
  },
}
