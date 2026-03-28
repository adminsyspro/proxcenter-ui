import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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
function parseNetString(id: string, raw: string): NetIface {
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
    const resources = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
    if (!resources || !Array.isArray(resources)) {
      return NextResponse.json({ data: [] })
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

            const nets: NetIface[] = []
            if (config) {
              for (const [key, val] of Object.entries(config)) {
                if (/^net\d+$/.test(key) && typeof val === "string") {
                  nets.push(parseNetString(key, val))
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

    return NextResponse.json({ data: results })
  } catch (e: any) {
    console.error("[networks] Error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
