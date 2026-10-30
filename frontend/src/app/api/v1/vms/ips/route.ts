import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { daemonNodeKey, DaemonSlotExpired, withDaemonSlot } from "@/lib/proxmox/daemonSlots"
import { callGuestAgent, isGuestAgentMuted } from "@/lib/proxmox/guestAgentCall"
import { getConnectionById, type PveConn } from "@/lib/connections/getConnection"
import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "@/lib/inventory/concurrency"
import { parseVmConfig } from "@/lib/inventory/vmConfig"
import { checkPermission, filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"
import { isGuestType, isNodeName, isVmid, sessionGuestVisibility } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

/**
 * POST /api/v1/vms/ips
 *
 * IP, snapshot count and OS of the guests the inventory table shows, asked
 * for one page at a time (roadmap#179). Every call here but /config is a
 * protected PVE call, served by the 3 pvedaemon workers of the node: they go
 * through the node's slots (daemonSlots.ts), an agent that did not answer is
 * left alone for a while (guestAgentCall.ts), and the agent is only asked
 * when the VM options enable it. The uptime comes from /cluster/resources
 * with the inventory, it is not read here.
 *
 * Body: { vms: [{ connId, type, node, vmid, status }] }
 * Response: { data: { "connId:type:node:vmid": { ip, snapshots, osInfo } }, pending: [keys] }
 * `pending` lists the guests the time budget left out: ask for them again.
 */

/** Longer than a table page (100 rows), shorter than anything a proxy cuts. */
const MAX_VMS = 200
/** Calls not sent after this are left for the next request: nginx answers 504 at 60 s. */
const BUDGET_MS = 20_000
const DETAILS_TTL_MS = 60_000
/** The OS of a guest barely changes: one get-osinfo per VM and 6 hours. */
const OS_TTL_MS = 6 * 3_600_000
const MAX_CACHED = 10_000

type OsInfo = {
  type: 'linux' | 'windows' | 'other'
  name: string | null
  version: string | null
  kernel: string | null
}

type GuestDetails = { ip: string | null; snapshots: number | null; osInfo: OsInfo | null }

type GuestRef = { connId: string; type: 'qemu' | 'lxc'; node: string; vmid: string; status?: string; id: string }

const detailsCache = new Map<string, { at: number; details: GuestDetails }>()
const osCache = new Map<string, { at: number; osInfo: OsInfo | null }>()

/** Test hook: forget every cached answer. */
export function resetGuestDetailsCache() {
  detailsCache.clear()
  osCache.clear()
}

function remember<V>(cache: Map<string, V>, key: string, value: V) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!)
}

// Déterminer le type d'OS à partir des infos du guest agent
function getOsType(osInfo: any): 'linux' | 'windows' | 'other' {
  if (!osInfo) return 'other'

  const id = (osInfo.id || '').toLowerCase()
  const name = (osInfo.name || '').toLowerCase()

  if (id === 'mswindows' || name.includes('windows')) return 'windows'

  const linuxDistros = ['debian', 'ubuntu', 'centos', 'rhel', 'fedora', 'alpine', 'arch', 'opensuse', 'suse', 'mint', 'manjaro', 'rocky', 'alma', 'oracle', 'gentoo', 'slackware', 'nixos']

  if (linuxDistros.some(d => id.includes(d) || name.includes(d)) || name.includes('linux')) return 'linux'

  return 'other'
}

function agentOsInfo(osData: any): OsInfo | null {
  const result = osData?.result || osData

  if (!result || !(result.id || result.name || result['pretty-name'])) return null

  return {
    type: getOsType(result),
    name: result['pretty-name'] || result.name || null,
    version: result.version || result['version-id'] || null,
    kernel: result['kernel-release'] || null,
  }
}

function lxcOsInfo(config: Record<string, any> | null): OsInfo | null {
  // ostype peut être: debian, ubuntu, centos, fedora, archlinux, alpine, gentoo, nixos, opensuse, unmanaged
  const ostype = String(config?.ostype || '')

  if (!ostype) return null
  const isLinux = ['debian', 'ubuntu', 'centos', 'fedora', 'archlinux', 'alpine', 'gentoo', 'nixos', 'opensuse'].includes(ostype)

  return { type: isLinux ? 'linux' : 'other', name: ostype.charAt(0).toUpperCase() + ostype.slice(1), version: null, kernel: null }
}

/** The first routable IPv4 the agent reports. */
function agentIp(interfaces: any): string | null {
  const result = interfaces?.result || interfaces || []

  for (const iface of Array.isArray(result) ? result : []) {
    if (iface.name === 'lo') continue

    for (const addr of iface['ip-addresses'] || []) {
      if (addr['ip-address-type'] === 'ipv4' && addr['ip-address'] && !addr['ip-address'].startsWith('127.')) return addr['ip-address']
    }
  }

  return null
}

function lxcIp(interfaces: any): string | null {
  for (const iface of Array.isArray(interfaces) ? interfaces : []) {
    if (iface.name !== 'lo' && iface.inet) return String(iface.inet).split('/')[0]
  }

  return null
}

/** A static address of the config (`ip=` of ipconfig0 or net0), never dhcp. */
function configIp(raw: unknown): string | null {
  const match = /ip=([^/,]+)/.exec(String(raw ?? ''))

  return match && match[1] !== 'dhcp' ? match[1] : null
}

class Pending extends Error {}

/** A call the time budget left unsent makes the whole guest pending; any other failure is `fallback`. */
async function orFallback<T, F>(call: Promise<T>, fallback: (err: unknown) => F): Promise<T | F> {
  try {
    return await call
  } catch (err) {
    if (err instanceof DaemonSlotExpired) throw new Pending()

    return fallback(err)
  }
}

type GuestRead = {
  conn: PveConn
  vm: GuestRef
  config: Record<string, any> | null
  deadline: number
  /** Runs a protected call of the guest through its node's pvedaemon slots. */
  slot: <T>(call: () => Promise<T>) => Promise<T>
}

type AddressAndOs = Pick<GuestDetails, 'ip' | 'osInfo'>

async function lxcAddressAndOs({ conn, config, vm, slot }: GuestRead): Promise<AddressAndOs> {
  if (vm.status !== 'running') return { ip: null, osInfo: null }
  const ip = await orFallback(slot(() => pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(vm.node)}/lxc/${vm.vmid}/interfaces`)).then(lxcIp), () => null)

  return { ip: ip ?? configIp(config?.net0), osInfo: lxcOsInfo(config) }
}

async function qemuAddressAndOs({ conn, vm, config, deadline }: GuestRead): Promise<AddressAndOs> {
  const staticIp = configIp(config?.ipconfig0)

  if (vm.status !== 'running') return { ip: null, osInfo: null }
  if (!parseVmConfig(config).agentEnabled || isGuestAgentMuted(conn, vm.node, vm.vmid)) return { ip: staticIp, osInfo: null }

  const answered = await orFallback(callGuestAgent<any>(conn, vm.node, vm.vmid, 'network-get-interfaces', { deadline }).then(r => ({ ip: agentIp(r) })), () => null)

  if (!answered) return { ip: staticIp, osInfo: null }
  const ip = answered.ip ?? staticIp
  const osKey = `${conn.id}:${vm.node}:${vm.vmid}`
  const known = osCache.get(osKey)

  if (known && Date.now() - known.at < OS_TTL_MS) return { ip, osInfo: known.osInfo }
  // An old agent without get-osinfo: no OS, nothing to ask again for 6 h.
  const osInfo = await orFallback(callGuestAgent<any>(conn, vm.node, vm.vmid, 'get-osinfo', { deadline, mute: false }).then(agentOsInfo), () => null)

  remember(osCache, osKey, { at: Date.now(), osInfo })

  return { ip, osInfo }
}

async function readGuest(conn: PveConn, vm: GuestRef, deadline: number): Promise<GuestDetails> {
  const node = encodeURIComponent(vm.node)
  const slot = <T>(call: () => Promise<T>) => withDaemonSlot(daemonNodeKey(conn, vm.node), call, { deadline })
  const config = await pveFetch<Record<string, any>>(conn, `/nodes/${node}/${vm.type}/${vm.vmid}/config`).catch(() => null)
  const read: GuestRead = { conn, vm, config, deadline, slot }

  const [snapshots, rest] = await Promise.all([
    orFallback(slot(() => pveFetch<any[]>(conn, `/nodes/${node}/${vm.type}/${vm.vmid}/snapshot`)).then(list => (Array.isArray(list) ? list.filter(s => s.name !== 'current').length : 0)), () => null),
    vm.type === 'lxc' ? lxcAddressAndOs(read) : qemuAddressAndOs(read),
  ])

  return { snapshots, ...rest }
}

function parseGuests(raw: unknown): GuestRef[] {
  const out: GuestRef[] = []

  for (const vm of Array.isArray(raw) ? raw : []) {
    const connId = typeof vm?.connId === 'string' ? vm.connId : ''
    const vmid = String(vm?.vmid ?? '')

    if (!connId || !isGuestType(vm?.type) || !isNodeName(vm?.node) || !isVmid(vmid)) continue
    out.push({
      connId,
      type: vm.type,
      node: vm.node,
      vmid,
      status: typeof vm.status === 'string' ? vm.status : undefined,
      id: `${connId}:${vm.type}:${vm.node}:${vmid}`,
    })
  }

  return out
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))

    if (Array.isArray(body?.vms) && body.vms.length > MAX_VMS) {
      return NextResponse.json({ error: `At most ${MAX_VMS} guests per request` }, { status: 400 })
    }

    const guests = parseGuests(body?.vms)

    if (guests.length === 0) return NextResponse.json({ data: {}, pending: [] })

    const rbacCtx = await getRBACContext()
    const byConnection = new Map<string, GuestRef[]>()

    for (const vm of guests) byConnection.set(vm.connId, [...(byConnection.get(vm.connId) ?? []), vm])

    const data: Record<string, GuestDetails> = {}
    const pending: string[] = []
    const deadline = Date.now() + BUDGET_MS

    await Promise.all(
      Array.from(byConnection.entries()).map(async ([connId, connVms]) => {
        try {
          const conn = await getConnectionById(connId)
          let allowed = connVms
          let resources: any[] | undefined

          // The same per-guest RBAC as the inventory list (/api/v1/vms). Pool
          // and tag grants match on the guest's pool and tags: read from PVE
          // (/cluster/resources is not a protected call), never from the body.
          if (rbacCtx && !rbacCtx.isAdmin) {
            resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
            const meta = new Map((Array.isArray(resources) ? resources : []).map(r => [`${r.type}:${r.vmid}`, r]))
            const withMeta = connVms.map(vm => ({ ...vm, pool: meta.get(`${vm.type}:${vm.vmid}`)?.pool, tags: meta.get(`${vm.type}:${vm.vmid}`)?.tags }))

            allowed = await filterVmsByPermission(rbacCtx.principal ?? (rbacCtx.userId as string), withMeta, PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
          }

          // A vDC session only reads the guests of its pools.
          const scoped = await sessionGuestVisibility({ connectionId: connId, conn, resources })

          if (!scoped.ok || !scoped.visibility) return
          const visible = scoped.visibility

          await mapWithConcurrency(allowed.filter(vm => visible.has(vm.type, vm.vmid)), PVEPROXY_CONCURRENCY, async vm => {
            const hit = detailsCache.get(vm.id)

            if (hit && Date.now() - hit.at < DETAILS_TTL_MS) {
              data[vm.id] = hit.details

              return
            }
            try {
              const details = await readGuest(conn, vm, deadline)

              remember(detailsCache, vm.id, { at: Date.now(), details })
              data[vm.id] = details
            } catch (err) {
              if (err instanceof Pending) pending.push(vm.id)
            }
          })
        } catch (e) {
          console.error(`[vms/ips] Error for connection ${connId}:`, e)
        }
      })
    )

    return NextResponse.json({ data, pending })
  } catch (e: any) {
    console.error("[vms/ips] Error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
