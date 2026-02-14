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

function parseNetKeys(config: Record<string, unknown>, vmType: string): Array<{ iface: string; bridge: string; vlanTag: number | null; ip: string | null; cidr: number | null }> {
  const networks: Array<{ iface: string; bridge: string; vlanTag: number | null; ip: string | null; cidr: number | null }> = []

  for (const [key, value] of Object.entries(config)) {
    if (!/^net\d+$/.test(key) || typeof value !== 'string') continue

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
          cidr = parseInt(v.substring(slashIdx + 1), 10)
          if (!Number.isFinite(cidr)) cidr = null
        } else {
          ip = v
        }
      }
    }

    // QEMU: check matching ipconfig{N} for static IP
    if (vmType !== 'lxc') {
      const idx = key.replace('net', '')
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
              cidr = parseInt(v.substring(slashIdx + 1), 10)
              if (!Number.isFinite(cidr)) cidr = null
            } else {
              ip = v
            }
          }
        }
      }
    }

    if (bridge) {
      networks.push({ iface: key, bridge, vlanTag, ip, cidr })
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

    const data: Record<string, { networks: Array<{ iface: string; bridge: string; vlanTag: number | null; ip: string | null; cidr: number | null }> }> = {}

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

              const networks = parseNetKeys(config || {}, vm.type)
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
