import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { buildBridgeVlanMap, extractHostBridges, extractHostVlans, resolveEffectiveTag, type HostBridge, type HostVlan } from "@/lib/proxmox/hostVlanMap"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

type NetIface = {
  id: string
  model: string
  bridge: string
  macaddr?: string
  tag?: number
  /**
   * VLAN the guest actually rides: the per-NIC `tag` when present, otherwise the
   * VLAN derived from the host bridge it attaches to (traditional `bondX.N`
   * sub-interface layouts). Undefined when the guest is genuinely untagged.
   */
  effectiveTag?: number
  firewall?: boolean
  rate?: number
}

type VmNet = {
  vmid: string
  name: string
  node: string
  type: string
  status: string
  nets: NetIface[]
}

/**
 * Parse a Proxmox net string like:
 *   "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=100,firewall=1,rate=10"
 */
export function parseNetString(id: string, raw: string): NetIface {
  const parts = raw.split(",")
  const iface: NetIface = { id, model: "unknown", bridge: "unknown" }

  for (const part of parts) {
    const [key, val] = part.split("=")
    if (!val && parts.indexOf(part) === 0) {
      // First part is model=macaddr
      const [model, mac] = part.split("=")
      iface.model = model
      iface.macaddr = mac
    } else if (key === "bridge") {
      iface.bridge = val
    } else if (key === "tag") {
      iface.tag = Number.parseInt(val, 10)
    } else if (key === "firewall") {
      iface.firewall = val === "1"
    } else if (key === "rate") {
      iface.rate = Number.parseFloat(val)
    } else if (key === "macaddr") {
      iface.macaddr = val
    } else if (!iface.macaddr && val && /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(val)) {
      iface.model = key
      iface.macaddr = val
    }
  }

  return iface
}

/**
 * GET /api/v1/connections/[id]/networks
 *
 * Batch-fetch network config for all VMs/CTs of a connection.
 * Uses /cluster/resources to get VM list, then fetches configs in parallel
 * with concurrency limiting.
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })
    }

    // RBAC check
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)

    // Get all VMs/CTs from cluster resources
    const allResources = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
    if (!allResources || !Array.isArray(allResources)) {
      return NextResponse.json({ data: [], bridges: [], vlans: [], vnetAliases: {} })
    }

    // Restrict to the tenant's vDC pool(s) on this connection. Without this,
    // a tenant viewing /infrastructure/inventory > Network sees every VM on
    // a shared PVE cluster (cross-vDC leak). super-admin / provider tenant
    // returns null scope -> no filtering applied.
    const tenantId = await getCurrentTenantId()
    // provider + msp see the full cluster (maskingScope null → no pool filter);
    // iaas tenants are restricted to their vDC pools.
    const vdcScope = maskingScope(await getTenantInfrastructureScope(tenantId))
    let resources = allResources
    if (vdcScope) {
      const allowedPools = vdcScope.poolsByConnection.get(id)
      resources = allowedPools
        ? allResources.filter((vm: any) => typeof vm?.pool === 'string' && allowedPools.has(vm.pool))
        : []
    }

    const isProviderScope = !vdcScope

    // For provider scope, fetch SDN VNet aliases so the UI can display friendly
    // names instead of raw VNet ids (e.g. "v42fc503"). Fault-tolerant: if SDN is
    // unavailable the map stays empty and raw ids are shown.
    let vnetAliases: Record<string, string> = {}
    if (isProviderScope) {
      try {
        const vnets = await pveFetch<any[]>(conn, "/cluster/sdn/vnets")
        if (Array.isArray(vnets)) {
          for (const v of vnets) {
            if (
              v &&
              typeof v.vnet === "string" &&
              typeof v.alias === "string" &&
              v.alias.length > 0 &&
              v.alias !== v.vnet
            ) {
              vnetAliases[v.vnet] = v.alias
            }
          }
        }
      } catch { /* SDN unavailable — fall back to raw bridge names */ }
    }

    // For provider scope, enumerate ALL cluster nodes so host bridges are surfaced
    // even when no VMs exist on them. For tenant scope, only visit nodes that
    // actually host the tenant's VMs (avoids extra PVE calls outside the pool).
    let nodeNames: string[]
    if (isProviderScope) {
      try {
        const clusterNodes = await pveFetch<any[]>(conn, "/cluster/resources?type=node")
        nodeNames = Array.isArray(clusterNodes)
          ? clusterNodes
              .map((n: any) => n?.node)
              .filter((n: any): n is string => typeof n === "string" && n.length > 0)
          : []
      } catch {
        nodeNames = []
      }
    } else {
      nodeNames = [...new Set(
        resources.map((vm: any) => vm?.node).filter((n: any): n is string => typeof n === "string" && n.length > 0)
      )]
    }

    // Build a per-node `bridge -> VLAN` map from each node's host networking.
    // This lets us resolve the effective VLAN of guests on the traditional
    // layout (a `bondX.N` sub-interface feeding a dedicated bridge), which carry
    // no per-NIC tag and would otherwise all show up as Untagged (discussion #389).
    const bridgeVlanByNode = new Map<string, Map<string, number>>()
    const hostBridgesIfacesByNode = new Map<string, any[]>()
    await Promise.all(
      nodeNames.map(async (node) => {
        try {
          const ifaces = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/network`)
          const ifaceArr = Array.isArray(ifaces) ? ifaces : []
          bridgeVlanByNode.set(node, buildBridgeVlanMap(ifaceArr))
          if (isProviderScope) hostBridgesIfacesByNode.set(node, ifaceArr)
        } catch {
          // Host network unavailable for this node — guests fall back to NIC tags only.
          bridgeVlanByNode.set(node, new Map())
        }
      })
    )

    // Collect host bridges and host VLAN sub-interfaces for provider scope, so
    // both surface in the inventory Network view even when no VM is attached.
    // VLANs previously only came from guest NIC tags, so empty VLANs never
    // appeared while empty bridges did (issue #542).
    const hostBridges: HostBridge[] = []
    const hostVlans: HostVlan[] = []
    if (isProviderScope) {
      for (const [node, ifaces] of hostBridgesIfacesByNode) {
        const map = bridgeVlanByNode.get(node) ?? new Map<string, number>()
        hostBridges.push(...extractHostBridges(node, ifaces, map))
        hostVlans.push(...extractHostVlans(node, ifaces))
      }
    }

    // Batch fetch configs with concurrency limit
    const CONCURRENCY = 15
    const results: VmNet[] = []

    for (let i = 0; i < resources.length; i += CONCURRENCY) {
      const batch = resources.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map(async (vm: any) => {
          const vmType = vm.type === "lxc" ? "lxc" : "qemu"
          const vmid = String(vm.vmid)
          const node = vm.node

          try {
            const config = await pveFetch<Record<string, any>>(
              conn,
              `/nodes/${encodeURIComponent(node)}/${vmType}/${encodeURIComponent(vmid)}/config`
            )

            const bridgeVlanMap = bridgeVlanByNode.get(node) ?? new Map<string, number>()
            const nets: NetIface[] = []
            if (config) {
              for (const [key, val] of Object.entries(config)) {
                if (/^net\d+$/.test(key) && typeof val === "string") {
                  const iface = parseNetString(key, val)
                  iface.effectiveTag = resolveEffectiveTag(iface.tag, iface.bridge, bridgeVlanMap)
                  nets.push(iface)
                }
              }
            }

            return {
              vmid,
              name: vm.name || vmid,
              node,
              type: vmType,
              status: vm.status || "unknown",
              nets,
            }
          } catch {
            // Config fetch failed for this VM, skip it
            return null
          }
        })
      )

      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) {
          results.push(r.value)
        }
      }
    }

    return NextResponse.json({ data: results, bridges: isProviderScope ? hostBridges : [], vlans: isProviderScope ? hostVlans : [], vnetAliases })
  } catch (e: any) {
    console.error("[networks] Error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
