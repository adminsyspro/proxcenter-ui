/**
 * Host hardware lookups for the agentic assistant (#459).
 *
 * The snapshot in `@/lib/ai/context` carries a host's live CPU and RAM usage
 * but nothing about its physical build, so the two questions the issue asks
 * literally ("how many interfaces does host 1 have?", "how many hard disks
 * does this host have?") were unanswerable without a tool call.
 *
 * Three Proxmox endpoints answer them, and they fail independently: a token
 * with `Sys.Audit` reads `/status` and `/network` but is refused
 * `/disks/list`. Losing the disk inventory must not cost the caller the
 * interface count as well, so every section degrades on its own and the tool
 * only throws when the host itself could not be resolved.
 */

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'

import { argString, resolveNode, type AiTool } from './types'

const BYTES_PER_GB = 1024 * 1024 * 1024

/** Truncated: a PVE error message can carry a whole HTML body. */
const MAX_REASON_CHARS = 200

/**
 * SMART verdicts that are not a warning. `UNKNOWN` covers a disk PVE could
 * not query at all, and some firmwares answer `OK` rather than `PASSED`:
 * treating either as a failure would make the assistant cry wolf.
 */
const HEALTHY_SMART_VERDICTS = new Set(['passed', 'ok', 'unknown'])

/** Interface types Proxmox reports for a real NIC, as opposed to a software one. */
const PHYSICAL_IFACE_TYPE = 'eth'

function num(value: unknown): number {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

function gb(bytes: unknown, digits = 1): number {
  const value = num(bytes)

  if (value <= 0) return 0

  return Number((value / BYTES_PER_GB).toFixed(digits))
}

function pct(used: unknown, total: unknown): number {
  const u = num(used)
  const t = num(total)

  if (u <= 0 || t <= 0) return 0

  return Number(((u / t) * 100).toFixed(1))
}

/** Why a section is missing, in words a model can pass on to the user. */
function failureReason(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'Proxmox returned no data for this section.'

  const reason = result.reason as { message?: string } | undefined
  const message = reason?.message || String(result.reason)

  return message.slice(0, MAX_REASON_CHARS)
}

/**
 * Drop null/undefined keys. A host with twenty interfaces would otherwise
 * spend most of its payload on `bondMode: null`, and the local models this
 * feeds (mistral:7b and friends) answer worse the more filler they read.
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) out[key] = value
  }

  return out as Partial<T>
}

function countBy(entries: any[], key: string): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const entry of entries) {
    const value = String(entry?.[key] || 'unknown')

    counts[value] = (counts[value] || 0) + 1
  }

  return counts
}

function buildCpuSection(status: any) {
  const info = status?.cpuinfo || {}
  const sockets = num(info.sockets)
  const cores = num(info.cores)

  // Proxmox reports `cores` per socket; the asker wants the host total. `cpus`
  // counts threads, so it is only a fallback for a host that omits either.
  const totalCores = cores * sockets || num(info.cpus) || null

  return compact({
    model: info.model || null,
    sockets: sockets || null,
    cores: cores || null,
    totalCores,
    mhz: info.mhz ? Number(info.mhz) : null,
  })
}

function buildNetworkSection(entries: any[]) {
  return {
    interfaceCount: entries.length,
    // Bridges, bonds and VLAN sub-interfaces are software constructs. Someone
    // counting "interfaces" on a host means the cards, so both figures ship.
    physicalInterfaceCount: entries.filter(e => e?.type === PHYSICAL_IFACE_TYPE).length,
    interfaceCountByType: countBy(entries, 'type'),
    interfaces: entries.map(entry => compact({
      iface: entry?.iface || null,
      type: entry?.type || null,
      active: entry?.active === 1 || entry?.active === true,
      address: entry?.address || null,
      cidr: entry?.cidr || null,
      gateway: entry?.gateway || null,
      bridgePorts: entry?.bridge_ports || null,
      bondMode: entry?.bond_mode || null,
      slaves: entry?.slaves || null,
      // PVE serialises this one hyphenated; the underscore form is a fallback
      // for older releases.
      vlanId: entry?.['vlan-id'] ?? entry?.vlan_id ?? null,
      mtu: entry?.mtu ?? null,
    })),
  }
}

function buildDisksSection(entries: any[]) {
  let totalRawBytes = 0

  const disks = entries.map(entry => {
    totalRawBytes += num(entry?.size)

    // -1 is Proxmox for "no Ceph OSD on this disk". Left as-is, the model
    // reports a host running "OSD -1".
    const osdid = entry?.osdid === undefined || entry?.osdid === null ? -1 : num(entry.osdid)

    return compact({
      devpath: entry?.devpath || null,
      model: entry?.model || null,
      vendor: entry?.vendor || null,
      serial: entry?.serial || null,
      sizeGb: gb(entry?.size),
      type: entry?.type || null,
      health: entry?.health || null,
      wearout: entry?.wearout ?? null,
      used: entry?.used || null,
      osdId: osdid === -1 ? null : osdid,
      rpm: entry?.rpm ?? null,
    })
  })

  const failingDisks = entries
    .filter(entry => {
      const health = String(entry?.health || '').trim().toLowerCase()

      return health.length > 0 && !HEALTHY_SMART_VERDICTS.has(health)
    })
    .map(entry => ({
      devpath: entry?.devpath || null,
      model: entry?.model || null,
      health: entry?.health || null,
    }))

  return {
    diskCount: entries.length,
    diskCountByType: countBy(entries, 'type'),
    totalRawCapacityGb: gb(totalRawBytes),
    failingDisks,
    disks,
  }
}

export const getNodeHardwareTool: AiTool = {
  name: 'get_node_hardware',

  description:
    'Physical hardware of one Proxmox host: CPU model and total cores, RAM, how many network interfaces it has, and how many physical disks with their size and SMART health. Answers "how many interfaces does host X have?", "how many disks does this host have?" and "is any disk failing on host X?" (SMART health per disk). Example: node=\'pve1\'',

  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Host name, for example pve1. Omit when the cluster has a single host.',
      },
      cluster: {
        type: 'string',
        description: 'Cluster name. Omit when only one cluster is visible.',
      },
    },
  },

  async execute(args, ctx) {
    // Security gate: the host must exist in the RBAC-filtered snapshot before
    // any Proxmox call is made. Never bypass.
    const { connection, node } = resolveNode(ctx, argString(args, 'node'), argString(args, 'cluster'))

    const conn = await getConnectionById(connection.id, ctx.tenantId)
    const base = `/nodes/${encodeURIComponent(node.name)}`

    const [statusResult, networkResult, disksResult] = await Promise.allSettled([
      pveFetch<any>(conn, `${base}/status`),
      pveFetch<any[]>(conn, `${base}/network`),
      pveFetch<any[]>(conn, `${base}/disks/list`),
    ])

    const result: Record<string, unknown> = {
      cluster: connection.name,
      node: node.name,
      status: node.status,
    }

    const status = statusResult.status === 'fulfilled' ? statusResult.value : null

    if (status) {
      result.cpu = buildCpuSection(status)
      result.memory = {
        totalGb: gb(status.memory?.total),
        usedGb: gb(status.memory?.used),
        usedPct: pct(status.memory?.used, status.memory?.total),
      }
      result.rootfs = {
        totalGb: gb(status.rootfs?.total),
        usedGb: gb(status.rootfs?.used),
      }
      result.kernel = status.kversion || null
      result.pveVersion = status.pveversion || null
      result.uptimeSeconds = num(status.uptime) || null
      result.loadAverage = Array.isArray(status.loadavg) ? status.loadavg.map(Number) : null
    } else {
      result.system = { available: false, reason: failureReason(statusResult) }
    }

    const network = networkResult.status === 'fulfilled' && Array.isArray(networkResult.value)
      ? networkResult.value
      : null

    result.network = network
      ? buildNetworkSection(network)
      : { available: false, reason: failureReason(networkResult) }

    const rawDisks = disksResult.status === 'fulfilled' && Array.isArray(disksResult.value)
      ? disksResult.value
      : null

    // A restricted API token is routinely refused /disks/list while /status and
    // /network answer fine, so this is the expected partial answer, not an edge
    // case worth failing the whole tool over.
    result.disks = rawDisks
      ? buildDisksSection(rawDisks)
      : { available: false, reason: failureReason(disksResult) }

    return result
  },
}
