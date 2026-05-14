import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertVdcPbsAccess } from "@/lib/vdc/scope"

export const runtime = "nodejs"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // First verify authentication (will throw on 401/403)
    const version = await pbsFetch<any>(conn, "/version")

    // Then fetch non-critical data (ok to swallow errors)
    const [status, datastores] = await Promise.all([
      pbsFetch<any>(conn, "/status").catch(() => null),
      pbsFetch<any[]>(conn, "/admin/datastore").catch(() => []),
    ])

    // For vDC tenants, only count datastores they have a binding on.
    const allowedDatastores = access.kind === 'tenant'
      ? new Set(access.allowed.map(a => a.datastore))
      : null

    const visibleDatastores = (datastores || []).filter((ds: any) => {
      if (!allowedDatastores) return true
      const name = ds.store || ds.name


return name && allowedDatastores.has(name)
    })

    // Récupérer les stats de chaque datastore en parallèle
    let totalSize = 0
    let totalUsed = 0

    const datastoreStatsPromises = visibleDatastores.map(async (ds) => {
      const storeName = ds.store || ds.name

      if (!storeName) return null

      try {
        const dsStatus = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/status`)


return {
          name: storeName,
          total: dsStatus?.total || 0,
          used: dsStatus?.used || 0,
          avail: dsStatus?.avail || 0,
        }
      } catch (e) {
        return null
      }
    })

    const datastoreStats = await Promise.all(datastoreStatsPromises)

    for (const ds of datastoreStats) {
      if (ds) {
        totalSize += ds.total
        totalUsed += ds.used
      }
    }

    return NextResponse.json({
      data: {
        status: status?.status || 'unknown',
        version: version?.version || 'unknown',
        release: version?.release || '',
        uptime: status?.uptime || 0,
        bootInfo: status?.['boot-info'] || null,
        cpuInfo: status?.cpuinfo || null,
        memory: status?.memory || null,
        load: status?.load || null,
        ksmsharing: status?.ksmsharing || null,

        // Stats calculées
        datastoreCount: visibleDatastores.length,
        totalSize,
        totalUsed,
        usagePercent: totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0,
      }
    })
  } catch (e: any) {
    console.error("PBS status error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
