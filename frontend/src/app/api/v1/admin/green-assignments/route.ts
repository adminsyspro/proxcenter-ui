import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

/**
 * GET /api/v1/admin/green-assignments
 *
 * Returns the global map of which datacentre owns which cluster / node so
 * the assignment tree in the DC dialog can grey out rows already anchored
 * elsewhere. The frontend uses this in tandem with the per-DC GET to
 * compute "this DC vs another DC" UI states.
 *
 * Shape:
 *   {
 *     clusters: { [connectionId]: { datacenterId, datacenterName } },
 *     nodes:    { [connectionId+'|'+nodeName]: { datacenterId, datacenterName } },
 *   }
 *
 * Only direct assignments are reported (rows with non-NULL datacenter_id).
 * Inherited DCs (cluster -> nodes) must be derived client-side.
 */
export async function GET() {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const [clusterRows, nodeRows] = await Promise.all([
      prisma.connectionGreenConfig.findMany({
        where: { datacenterId: { not: null } },
        select: {
          connectionId: true,
          datacenterId: true,
          datacenter: { select: { name: true } },
        },
      }),
      prisma.nodeGreenConfig.findMany({
        where: { datacenterId: { not: null } },
        select: {
          connectionId: true,
          nodeName: true,
          datacenterId: true,
          datacenter: { select: { name: true } },
        },
      }),
    ])

    const clusters: Record<string, { datacenterId: string; datacenterName: string }> = {}

    for (const r of clusterRows) {
      if (!r.datacenterId) continue
      clusters[r.connectionId] = {
        datacenterId: r.datacenterId,
        datacenterName: r.datacenter?.name ?? '',
      }
    }

    const nodes: Record<string, { datacenterId: string; datacenterName: string }> = {}

    for (const r of nodeRows) {
      if (!r.datacenterId) continue
      nodes[`${r.connectionId}|${r.nodeName}`] = {
        datacenterId: r.datacenterId,
        datacenterName: r.datacenter?.name ?? '',
      }
    }

    return NextResponse.json({ data: { clusters, nodes } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
