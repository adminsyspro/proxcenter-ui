import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import {
  getConnectionGreenConfig,
  upsertConnectionGreenConfig,
  listNodeGreenConfigs,
  clearAllNodeDatacenterOverrides,
} from "@/lib/db/greenConfig"
import { invalidateGreenResolution } from "@/lib/green/resolve"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

/**
 * Returns the cluster-level green config + per-node overrides for this
 * connection. The `nodes` array is the **union** of nodes that have an
 * explicit `node_green_config` row AND the live node list from PVE — so the
 * UI can show every node with placeholder fields even when nothing is saved
 * yet.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: 'Missing connection id' }, { status: 400 })

    const cluster = await getConnectionGreenConfig(id)
    const savedNodes = await listNodeGreenConfigs(id)

    // Live node list (with status) — best-effort; if PVE is unreachable we
    // fall back to saved rows only. The status is exposed so the assignment
    // tree can render the proper Proxmox icon + traffic-light dot.
    let liveNodes: Array<{ name: string; status: string }> = []

    try {
      const conn = await getConnectionById(id)
      const arr = await pveFetch<any[]>(conn, '/nodes').catch(() => [])

      liveNodes = (arr || [])
        .map((n: any) => ({ name: String(n.node ?? ''), status: String(n.status ?? '') }))
        .filter(n => n.name)
    } catch {
      // Connection may be inaccessible at config time.
    }

    const liveByName = new Map(liveNodes.map(n => [n.name, n.status]))
    const known = new Set<string>([...savedNodes.map(n => n.nodeName), ...liveByName.keys()])

    const nodes = Array.from(known).sort((a, b) => a.localeCompare(b)).map(nodeName => {
      const saved = savedNodes.find(n => n.nodeName === nodeName)
      const status = liveByName.get(nodeName) || null

      const base = saved ?? {
        connectionId: id,
        nodeName,
        datacenterId: null,
        tdpPerCoreW: null,
        wattsPerGbRam: null,
        overheadPerNodeW: null,
        updatedAt: '',
      }


return { ...base, status }
    })

    return NextResponse.json({ data: { cluster, nodes } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: 'Missing connection id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as any

    const cluster = await upsertConnectionGreenConfig(id, {
      datacenterId: body.datacenterId ?? null,
      tdpPerCoreW: body.tdpPerCoreW ?? null,
      wattsPerGbRam: body.wattsPerGbRam ?? null,
      overheadPerNodeW: body.overheadPerNodeW ?? null,
    })

    // Optional bulk action: when applyToAllNodes is true, clear every per-node
    // DC override so all nodes inherit the cluster's DC.
    if (body.applyToAllNodes === true) {
      await clearAllNodeDatacenterOverrides(id)
    }

    invalidateGreenResolution(id)

return NextResponse.json({ data: cluster })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
