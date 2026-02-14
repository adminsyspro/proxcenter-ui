import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * POST /api/v1/vms/networks
 *
 * Bulk-fetch network config (bridge + VLAN tag) for a list of VMs.
 *
 * Body: { vms: [{ connId, type, node, vmid }] }
 * Response: { data: { "connId:type:node:vmid": { networks: [{ iface, bridge, vlanTag }] } } }
 */

function parseNetKeys(config: Record<string, unknown>): Array<{ iface: string; bridge: string; vlanTag: number | null }> {
  const networks: Array<{ iface: string; bridge: string; vlanTag: number | null }> = []

  for (const [key, value] of Object.entries(config)) {
    if (!/^net\d+$/.test(key) || typeof value !== 'string') continue

    let bridge = ''
    let vlanTag: number | null = null

    for (const part of value.split(',')) {
      const [k, v] = part.split('=')

      if (k === 'bridge') bridge = v || ''
      else if (k === 'tag') {
        const n = Number(v)

        if (Number.isFinite(n)) vlanTag = n
      }
    }

    if (bridge) {
      networks.push({ iface: key, bridge, vlanTag })
    }
  }

  return networks
}

export async function POST(req: Request) {
  try {
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

    const data: Record<string, { networks: Array<{ iface: string; bridge: string; vlanTag: number | null }> }> = {}

    await Promise.all(
      Array.from(byConnection.entries()).map(async ([connId, connVms]) => {
        try {
          const connData = await getConnectionById(connId)

          const results = await Promise.allSettled(
            connVms.map(async (vm) => {
              const config = await pveFetch<Record<string, unknown>>(
                connData,
                `/nodes/${encodeURIComponent(vm.node)}/${vm.type}/${vm.vmid}/config`
              )

              const networks = parseNetKeys(config || {})
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
