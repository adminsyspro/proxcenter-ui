import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"
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

    // Récupérer la liste des datastores
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

    // For vDC tenants, restrict to their bound datastores.
    const allowedDatastores = access.kind === 'tenant'
      ? new Set(access.allowed.map(a => a.datastore))
      : null

    const visibleDatastores = (datastores || []).filter((ds: any) => {
      if (!allowedDatastores) return true
      const name = ds.store || ds.name


return name && allowedDatastores.has(name)
    })

    // Enrichir chaque datastore avec des infos supplémentaires
    const enrichedDatastores = await Promise.all(
      visibleDatastores.map(async (ds) => {
        // PBS utilise "store" comme nom du datastore
        const storeName = ds.store || ds.name

        // Essayer de récupérer les stats du datastore
        let status: any = null

        if (storeName) {
          try {
            status = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/status`)
          } catch (e) {
            // Ignorer les erreurs
          }
        }

        const total = status?.total || ds.total || 0
        const used = status?.used || ds.used || 0
        const available = status?.avail || ds.avail || (total - used)
        const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0

        return {
          name: storeName,
          path: ds.path || '',
          comment: ds.comment || '',

          // Espace disque
          total,
          used,
          available,
          usagePercent,
          totalFormatted: formatBytes(total),
          usedFormatted: formatBytes(used),
          availableFormatted: formatBytes(available),

          // Compteurs de backups (vm + ct + host)
          counts: ds.counts || status?.counts || {},
          vmCount: ds.counts?.vm || status?.counts?.vm || 0,
          ctCount: ds.counts?.ct || status?.counts?.ct || 0,
          hostCount: ds.counts?.host || status?.counts?.host || 0,
          backupCount: (ds.counts?.vm || status?.counts?.vm || 0) +
                       (ds.counts?.ct || status?.counts?.ct || 0) +
                       (ds.counts?.host || status?.counts?.host || 0),

          // GC (Garbage Collection)
          gcStatus: status?.['gc-status'] || null,

          // Vérification
          verifyStatus: status?.['verify-status'] || null,
        }
      })
    )

    return NextResponse.json({
      data: enrichedDatastores
    })
  } catch (e: any) {
    console.error("PBS datastores error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
