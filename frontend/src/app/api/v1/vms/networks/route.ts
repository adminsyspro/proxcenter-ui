import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, type PveConn } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { buildBridgeVlanMap } from "@/lib/proxmox/hostVlanMap"
import { buildSdnVnets, type SdnVnet } from "@/lib/proxmox/sdnVnetMap"
import { buildVnetIndex, resolveNicSegment, type NicSegment } from "@/lib/proxmox/nicSegment"

export const runtime = "nodejs"

type VmNic = {
  iface: string
  bridge: string
  vlanTag: number | null
  ip: string | null
  cidr: number | null
  /**
   * Resolved segment: the SDN VNet the bridge names, else the per-NIC tag, else
   * the VLAN of the host bridge. Added because the topology used to read
   * `vlanTag` alone, which sent every SDN-attached guest to the "No VLAN"
   * bucket. See lib/proxmox/nicSegment.ts.
   */
  segment: NicSegment
}

/**
 * POST /api/v1/vms/networks
 *
 * Bulk-fetch network config (bridge + VLAN tag + resolved segment) for a list of VMs.
 *
 * Body: { vms: [{ connId, type, node, vmid }] }
 * Response: { data: { "connId:type:node:vmid": { networks: [{ iface, bridge, vlanTag, segment }] } } }
 */

export function parseNetKeys(config: Record<string, unknown>, vmType: string): Array<{ iface: string; bridge: string; vlanTag: number | null; ip: string | null; cidr: number | null }> {
  const networks: Array<{ index: number; iface: string; bridge: string; vlanTag: number | null; ip: string | null; cidr: number | null }> = []

  for (const [key, value] of Object.entries(config)) {
    const match = /^net(\d+)$/.exec(key)

    if (!match || typeof value !== 'string') continue

    let bridge = ''
    let vlanTag: number | null = null
    let ip: string | null = null
    let cidr: number | null = null

    for (const part of value.split(',')) {
      const [k, v] = part.split('=')

      if (k === 'bridge') bridge = v || ''
      else if (k === 'tag') {
        const n = Number(v)

        if (Number.isFinite(n)) vlanTag = n
      } else if (k === 'ip' && vmType === 'lxc' && v) {
        // LXC: net0 has ip=x.x.x.x/y
        const slashIdx = v.indexOf('/')

        if (slashIdx > 0) {
          ip = v.substring(0, slashIdx)
          cidr = Number.parseInt(v.substring(slashIdx + 1), 10)
          if (!Number.isFinite(cidr)) cidr = null
        } else {
          ip = v
        }
      }
    }

    // QEMU: check matching ipconfig{N} for static IP
    if (vmType !== 'lxc') {
      const idx = key.replaceAll('net', '')
      const ipconfigVal = config[`ipconfig${idx}`]

      if (typeof ipconfigVal === 'string') {
        for (const part of ipconfigVal.split(',')) {
          const eqIdx = part.indexOf('=')

          if (eqIdx < 0) continue
          const k = part.substring(0, eqIdx)
          const v = part.substring(eqIdx + 1)

          if (k === 'ip' && v) {
            const slashIdx = v.indexOf('/')

            if (slashIdx > 0) {
              ip = v.substring(0, slashIdx)
              cidr = Number.parseInt(v.substring(slashIdx + 1), 10)
              if (!Number.isFinite(cidr)) cidr = null
            } else {
              ip = v
            }
          }
        }
      }
    }

    if (bridge) {
      networks.push({ index: Number.parseInt(match[1], 10), iface: key, bridge, vlanTag, ip, cidr })
    }
  }

  // PVE serializes a guest config from a Perl hash, whose iteration order is
  // randomized per process (Perl >= 5.18), so `net0` is NOT reliably the first
  // key returned. Callers treat the head of this list as the primary NIC (the
  // topology groups a guest by it), so the order has to be restored here.
  networks.sort((a, b) => a.index - b.index)

  return networks.map(({ index: _index, ...nic }) => nic)
}

/**
 * Resolve a connection's SDN VNets, joined with their zones so a VNet-backed
 * NIC can name its real segment. Fault-tolerant on purpose: a cluster without
 * SDN, or an SDN endpoint the token cannot read, yields an empty index and
 * resolution simply degrades to per-NIC tags.
 */
async function fetchSdnVnets(conn: PveConn): Promise<SdnVnet[]> {
  let vnetsRaw: any[] = []
  let zonesRaw: any[] = []

  try {
    const vnets = await pveFetch<any[]>(conn, "/cluster/sdn/vnets")
    if (Array.isArray(vnets)) vnetsRaw = vnets
  } catch {
    // SDN unavailable — no VNet grouping, raw bridge names stay.
    return []
  }

  // Zones are independent: without them a VNet keeps zoneType '' and is still
  // grouped on its own, it just cannot say "VLAN" vs "VNI".
  try {
    const zones = await pveFetch<any[]>(conn, "/cluster/sdn/zones")
    if (Array.isArray(zones)) zonesRaw = zones
  } catch { /* zone metadata unavailable */ }

  return buildSdnVnets(vnetsRaw, zonesRaw)
}

/**
 * Per-node `bridge -> VLAN` maps for the nodes actually hosting the requested
 * guests. Resolves the traditional layout (a `bondX.N` sub-interface feeding a
 * dedicated bridge), whose guests carry no per-NIC tag.
 */
async function fetchBridgeVlanMaps(conn: PveConn, nodes: string[]): Promise<Map<string, Map<string, number>>> {
  const byNode = new Map<string, Map<string, number>>()

  await Promise.all(
    nodes.map(async (node) => {
      try {
        const ifaces = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/network`)

        byNode.set(node, buildBridgeVlanMap(Array.isArray(ifaces) ? ifaces : []))
      } catch {
        // Host network unreadable for this node — per-NIC tags only.
        byNode.set(node, new Map())
      }
    })
  )

  return byNode
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    // SDN VNets are provider-scope data, exactly as in the inventory Network
    // view: an iaas tenant gets no VNet grouping, so its guests on a VNet keep
    // the "No VLAN" bucket rather than learning the provider's segment names.
    const vdcScope = maskingScope(await getTenantInfrastructureScope(await getCurrentTenantId()))
    const isProviderScope = !vdcScope

    const body = await req.json()
    const vms = body.vms || []

    if (!Array.isArray(vms) || vms.length === 0) {
      return NextResponse.json({ data: {} })
    }

    // Group by connection
    const byConnection = new Map<string, Array<{ type: string; node: string; vmid: string }>>()

    for (const vm of vms) {
      if (!vm.connId || !vm.type || !vm.node || !vm.vmid) continue

      if (!byConnection.has(vm.connId)) {
        byConnection.set(vm.connId, [])
      }

      byConnection.get(vm.connId)!.push({ type: vm.type, node: vm.node, vmid: vm.vmid })
    }

    const data: Record<string, { networks: VmNic[] }> = {}

    await Promise.all(
      Array.from(byConnection.entries()).map(async ([connId, connVms]) => {
        try {
          const connData = await getConnectionById(connId)

          // Segment context, fetched once per connection rather than per guest.
          const nodeNames = [...new Set(connVms.map((vm) => vm.node))]
          const [sdnVnets, bridgeVlanByNode] = await Promise.all([
            isProviderScope ? fetchSdnVnets(connData) : Promise.resolve([] as SdnVnet[]),
            fetchBridgeVlanMaps(connData, nodeNames),
          ])
          const vnetById = buildVnetIndex(sdnVnets)

          const results = await Promise.allSettled(
            connVms.map(async (vm) => {
              const config = await pveFetch<Record<string, unknown>>(
                connData,
                `/nodes/${encodeURIComponent(vm.node)}/${vm.type}/${vm.vmid}/config`
              )

              const bridgeVlanMap = bridgeVlanByNode.get(vm.node) ?? new Map<string, number>()
              const networks: VmNic[] = parseNetKeys(config || {}, vm.type).map((nic) => ({
                ...nic,
                segment: resolveNicSegment({ bridge: nic.bridge, tag: nic.vlanTag }, vnetById, bridgeVlanMap),
              }))
              const key = `${connId}:${vm.type}:${vm.node}:${vm.vmid}`

              return { key, networks }
            })
          )

          for (const result of results) {
            if (result.status === 'fulfilled') {
              data[result.value.key] = { networks: result.value.networks }
            }
          }
        } catch (e) {
          console.error(`[vms/networks] Error for connection ${connId}:`, e)
        }
      })
    )

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error("[vms/networks] Error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
