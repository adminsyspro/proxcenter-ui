import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    // Optional ?vdcId=… so the create/edit modal can keep the current
    // vDC's own PBS storages visible while still hiding the storages
    // bound to OTHER vDCs on the same cluster (cross-vDC isolation).
    const url = new URL(req.url)
    const excludeForVdcId = url.searchParams.get("vdcId") || null

    // Admin endpoint: resolve connection's tenantId to bypass session tenant filter
    const connMeta = await prisma.connection.findUnique({ where: { id }, select: { tenantId: true } })

    if (!connMeta) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

    const conn = await getConnectionById(id, connMeta.tenantId)

    // Fetch nodes
    const nodesRaw = await pveFetch<any[]>(conn, "/nodes") || []

    const nodes = nodesRaw.map((n: any) => ({
      name: n.node,
      status: n.status,
      cpu: n.cpu,
      maxcpu: n.maxcpu,
      mem: n.mem,
      maxmem: n.maxmem,
    }))

    // Fetch storages: definition from /storage + per-node usage from /cluster/resources
    const storagesRaw = await pveFetch<any[]>(conn, "/storage") || []

    // Per-node usage: { "local": [{ node: "PVE-1", disk: X, maxdisk: Y }, ...], "ceph-pool": [{ node: "PVE-1", ... }] }
    const storageNodeUsage: Record<string, { node: string; disk: number; maxdisk: number }[]> = {}

    try {
      const resources = await pveFetch<any[]>(conn, "/cluster/resources?type=storage") || []

      for (const r of resources) {
        if (!r.storage) continue
        if (!storageNodeUsage[r.storage]) storageNodeUsage[r.storage] = []
        storageNodeUsage[r.storage].push({ node: r.node, disk: r.disk || 0, maxdisk: r.maxdisk || 0 })
      }
    } catch {}

    // PBS storages bound to OTHER vDCs on the same PVE cluster: each PBS
    // storage on PVE is a one-to-one bridge to a tenant-scoped namespace
    // (datastore/<tenant>/<vdc>) on PBS — letting another vDC also bind to
    // the same `pbs:` storage would expose that tenant's backups. We hide
    // them from the available-resources list so the admin modal can't
    // accidentally embed them in the new vDC.
    const pbsRows = await prisma.vdcPbsPveStorage.findMany({
      where: { pveConnectionId: id },
      select: { pveStorageName: true, vdcPbsNamespace: { select: { vdcId: true } } },
    })

    const hiddenPbsStorages = new Set(
      pbsRows
        .filter(r => !excludeForVdcId || r.vdcPbsNamespace.vdcId !== excludeForVdcId)
        .map(r => r.pveStorageName),
    )

    // vDC primary storage requirements: shared (HA-capable) and able to
    // host VM disk images. Local storages are filtered out because a
    // VM that lands on one cannot live-migrate, breaking the HA promise
    // of a vDC. Storages that only advertise iso/backup/vztmpl content
    // are excluded too — they can't back a VM disk. PBS pseudo-storages
    // are removed earlier in the chain (hiddenPbsStorages).
    const isImagesContent = (content: any) => {
      const tokens = String(content || '').split(',').map((t: string) => t.trim())


return tokens.includes('images') || tokens.includes('rootdir')
    }

    const storages = storagesRaw
      .filter((s: any) => !hiddenPbsStorages.has(s.storage))
      .filter((s: any) => !!s.shared && isImagesContent(s.content) && s.enabled !== 0)
      .map((s: any) => {
        const nodeEntries = storageNodeUsage[s.storage] || []

        // Shared storage: all nodes report identical usage, take first.
        const disk = nodeEntries[0]?.disk || 0
        const maxdisk = nodeEntries[0]?.maxdisk || 0

        return {
          id: s.storage,
          type: s.type,
          content: s.content,
          shared: true,
          nodes: s.nodes || null,
          disk,
          maxdisk,
        }
      })

    // Fetch existing PVE pools (to show what's taken)
    let pools: string[] = []

    try {
      const poolsRaw = await pveFetch<any[]>(conn, "/pools") || []

      pools = poolsRaw.map((p: any) => p.poolid)
    } catch {
      // Pools API may not be available
    }

    return NextResponse.json({ data: { nodes, storages, pools } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
