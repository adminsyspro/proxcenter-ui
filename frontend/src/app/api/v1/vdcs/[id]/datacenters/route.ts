import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getVdcById } from "@/lib/vdc"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { resolveGreenConfigForNode } from "@/lib/green/resolve"
import { getDatacenterById } from "@/lib/db/datacenters"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

interface DatacenterNode {
  name: string

  /** PVE status string ('online' | 'offline' | 'unknown'…). */
  status: string | null
  vmCount: number
  runningVmCount: number
}

interface DatacenterAggregate {
  id: string
  name: string
  locationLabel: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  comment: string | null
  nodeCount: number
  vmCount: number
  runningVmCount: number

  /** Derived health from underlying PVE nodes — all online → online, some
   *  offline → degraded, all offline → offline. VM run state is intentionally
   *  ignored: a tenant may legitimately keep VMs stopped (cost, maintenance)
   *  and that's not a DC-level degradation. */
  status: 'online' | 'degraded' | 'offline'

  /** Live node breakdown so popups can render Proxmox icons per node. */
  nodes: DatacenterNode[]
}

/**
 * GET /api/v1/vdcs/{id}/datacenters
 *
 * Returns the datacentres that host this vDC's resources, with per-DC
 * aggregates (node count, VM count, running VMs) so /my-vdc can render a
 * geographic map with one pin per DC and a status colour. The DC for each
 * node is resolved via the standard inheritance chain (node → cluster →
 * Default DC).
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id

    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)

    if (denied) return denied

    const vdc = await getVdcById(vdcId)

    if (!vdc) return NextResponse.json({ error: "vDC not found" }, { status: 404 })

    const tenantId = await getCurrentTenantId()

    if (vdc.tenantId !== tenantId) {
      return NextResponse.json({ error: "vDC not accessible" }, { status: 403 })
    }

    const allowedNodes = Array.isArray(vdc.nodes) ? vdc.nodes : []

    if (allowedNodes.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Resolve every allowed node → its current DC.
    const dcByNode = new Map<string, string>()

    for (const nodeName of allowedNodes) {
      const resolved = await resolveGreenConfigForNode(vdc.connectionId, nodeName)

      if (resolved.datacenter.id) dcByNode.set(nodeName, resolved.datacenter.id)
    }

    // Pull live VM list from the cluster, restricted to this vDC's pool, plus
    // the per-node status so we can render the right traffic-light dot in
    // each popup.
    const conn = await getConnectionById(vdc.connectionId)

    // Connection-level geo (set in /settings?tab=connections > Location).
    // Used as a fallback when the Green-IT datacentre resolved for a node
    // has no country / lat-lng of its own — keeps the tenant map readable
    // even when no Green-IT site catalogue has been configured.
    const connRow = await prisma.connection.findUnique({
      where: { id: vdc.connectionId },
      select: { country: true, latitude: true, longitude: true, locationLabel: true },
    })

    const connCountry = connRow?.country ?? null
    const connLat = connRow?.latitude ?? null
    const connLng = connRow?.longitude ?? null
    const connLocationLabel = connRow?.locationLabel ?? null

    const [guests, liveNodes] = await Promise.all([
      pveFetch<any[]>(conn, '/cluster/resources?type=vm').catch(() => []),
      pveFetch<any[]>(conn, '/cluster/resources?type=node').catch(() => []),
    ])

    const vdcVms = (guests || []).filter((g: any) =>
      typeof g?.pool === 'string'
      && g.pool === vdc.pvePoolName
      && allowedNodes.includes(String(g.node ?? '')),
    )

    const nodeStatusByName = new Map<string, string>()

    for (const n of (liveNodes || [])) {
      const name = String(n.node ?? '')

      if (name) nodeStatusByName.set(name, String(n.status ?? ''))
    }

    // Aggregate per DC.
    const acc = new Map<string, DatacenterAggregate>()

    for (const nodeName of allowedNodes) {
      const dcId = dcByNode.get(nodeName)

      if (!dcId) continue
      const dc = await getDatacenterById(dcId)

      if (!dc) continue

      const existing = acc.get(dcId) ?? {
        id: dc.id,
        name: dc.name,
        locationLabel: dc.locationLabel ?? connLocationLabel,
        country: dc.country ?? connCountry,
        latitude: dc.latitude ?? connLat,
        longitude: dc.longitude ?? connLng,
        comment: dc.comment,
        nodeCount: 0,
        vmCount: 0,
        runningVmCount: 0,
        status: 'online' as const,
        nodes: [],
      }

      existing.nodeCount += 1
      existing.nodes.push({
        name: nodeName,
        status: nodeStatusByName.get(nodeName) ?? null,
        vmCount: 0,
        runningVmCount: 0,
      })
      acc.set(dcId, existing)
    }

    // Merge VM counts per DC + per node.
    for (const vm of vdcVms) {
      const nodeName = String(vm.node ?? '')
      const dcId = dcByNode.get(nodeName)

      if (!dcId) continue
      const entry = acc.get(dcId)

      if (!entry) continue
      entry.vmCount += 1
      if (vm.status === 'running') entry.runningVmCount += 1
      const nodeEntry = entry.nodes.find(n => n.name === nodeName)

      if (nodeEntry) {
        nodeEntry.vmCount += 1
        if (vm.status === 'running') nodeEntry.runningVmCount += 1
      }
    }

    // Derive status from PVE node health only. Stopped VMs ≠ degraded DC.
    for (const entry of acc.values()) {
      if (entry.nodes.length === 0) {
        entry.status = 'online'
        continue
      }

      const onlineNodes = entry.nodes.filter(n => n.status === 'online').length

      if (onlineNodes === 0) entry.status = 'offline'
      else if (onlineNodes < entry.nodes.length) entry.status = 'degraded'
      else entry.status = 'online'
    }

    const data = Array.from(acc.values())


return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
