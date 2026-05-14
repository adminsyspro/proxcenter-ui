import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { getDatacenterById } from "@/lib/db/datacenters"
import { invalidateGreenResolution } from "@/lib/green/resolve"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

interface AssignmentPayload {

  /** Connection IDs whose entire cluster (and every node) should point to this DC. */
  clusters?: string[]

  /** Per-node assignments. Used when only a subset of a cluster's nodes are on this DC. */
  nodes?: Array<{ connectionId: string; nodeName: string }>
}

/**
 * GET — list every (connection, node) currently anchored on this datacentre.
 *
 * Returns clusters whose `connection_green_config.datacenter_id = id` and
 * nodes whose `node_green_config.datacenter_id = id`. The frontend tree
 * uses this to pre-check the right boxes when the dialog opens.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const dc = await getDatacenterById(id)

    if (!dc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [clusters, nodes] = await Promise.all([
      prisma.connectionGreenConfig.findMany({
        where: { datacenterId: id },
        select: { connectionId: true },
      }),
      prisma.nodeGreenConfig.findMany({
        where: { datacenterId: id },
        select: { connectionId: true, nodeName: true },
      }),
    ])

    return NextResponse.json({
      data: {
        clusters: clusters.map(r => r.connectionId),
        nodes: nodes.map(r => ({ connectionId: r.connectionId, nodeName: r.nodeName })),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT — atomically replace this datacentre's assignments.
 *
 * Resources listed in `clusters` get their cluster-level `datacenter_id`
 * set to this DC; per-node DC overrides on those clusters are wiped (the
 * cluster pick wins). Resources listed in `nodes` get their per-node
 * `datacenter_id` set to this DC. Anything previously anchored on this DC
 * but absent from the payload has its `datacenter_id` cleared back to
 * NULL — meaning "inherit from the level above".
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const dc = await getDatacenterById(id)

    if (!dc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => ({})) as AssignmentPayload
    const targetClusters = new Set((body.clusters ?? []).filter(Boolean))

    const targetNodes = new Set(
      (body.nodes ?? []).filter(n => n?.connectionId && n?.nodeName).map(n => `${n.connectionId}|${n.nodeName}`),
    )

    const now = new Date()

    await prisma.$transaction(async tx => {
      // Cluster-level: align connection_green_config rows.
      const currentClusters = (await tx.connectionGreenConfig.findMany({
        where: { datacenterId: id },
        select: { connectionId: true },
      })).map(r => r.connectionId)

      // Detach clusters that left this DC.
      for (const cid of currentClusters) {
        if (!targetClusters.has(cid)) {
          await tx.connectionGreenConfig.update({
            where: { connectionId: cid },
            data: { datacenterId: null, updatedAt: now },
          })
        }
      }

      // Attach (upsert) clusters that should be on this DC + clear per-node DC overrides
      // so the cluster pick is the single source of truth.
      for (const cid of targetClusters) {
        await tx.connectionGreenConfig.upsert({
          where: { connectionId: cid },
          update: { datacenterId: id, updatedAt: now },
          create: { connectionId: cid, datacenterId: id, updatedAt: now },
        })
        await tx.nodeGreenConfig.updateMany({
          where: { connectionId: cid },
          data: { datacenterId: null, updatedAt: now },
        })
      }

      // Per-node: align node_green_config rows.
      const currentNodes = (await tx.nodeGreenConfig.findMany({
        where: { datacenterId: id },
        select: { connectionId: true, nodeName: true },
      })).map(r => `${r.connectionId}|${r.nodeName}`)

      for (const key of currentNodes) {
        if (!targetNodes.has(key)) {
          const [cid, nname] = key.split('|')

          await tx.nodeGreenConfig.update({
            where: { connectionId_nodeName: { connectionId: cid, nodeName: nname } },
            data: { datacenterId: null, updatedAt: now },
          })
        }
      }

      for (const key of targetNodes) {
        const [cid, nname] = key.split('|')


        // Skip nodes whose cluster is itself on this DC — covered by cluster-level row.
        if (targetClusters.has(cid)) continue
        await tx.nodeGreenConfig.upsert({
          where: { connectionId_nodeName: { connectionId: cid, nodeName: nname } },
          update: { datacenterId: id, updatedAt: now },
          create: { connectionId: cid, nodeName: nname, datacenterId: id, updatedAt: now },
        })
      }
    })

    invalidateGreenResolution()

return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
