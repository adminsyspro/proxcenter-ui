import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertVdcPbsAccess } from "@/lib/vdc/scope"

export const runtime = "nodejs"

/**
 * Returns backup trends aggregated by day for the last N days.
 * Query params: days (default 30)
 */
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

    const url = new URL(req.url)
    const days = Math.min(Number.parseInt(url.searchParams.get('days') || '30', 10), 90)

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // Fetch all datastores
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

    // For vDC tenants, restrict to bound (datastore, namespace) tuples.
    const allowedNsByStore = access.kind === 'tenant'
      ? access.allowed.reduce((acc, a) => {
          const set = acc.get(a.datastore) ?? new Set<string>()

          set.add(a.namespace)
          acc.set(a.datastore, set)

return acc
        }, new Map<string, Set<string>>())
      : null

    const visibleDatastores = (datastores || []).filter((ds: any) => {
      if (!allowedNsByStore) return true
      const name = ds.store || ds.name


return name && allowedNsByStore.has(name)
    })

    // Fetch all snapshots from all datastores
    const allBackups: any[] = []

    const dsPromises = visibleDatastores.map(async (ds) => {
      const storeName = ds.store || ds.name

      if (!storeName) return []

      try {
        let namespaces: string[] = ['']

        try {
          const nsData = await pbsFetch<any[]>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/namespace`)

          if (Array.isArray(nsData)) {
            namespaces = ['', ...nsData.map(n => n.ns || '').filter(Boolean)]
          }
        } catch { /* older PBS */ }

        // Restrict namespaces to the ones the tenant is bound to.
        const allowedSet = allowedNsByStore?.get(storeName)

        if (allowedSet) {
          namespaces = namespaces.filter(ns => allowedSet.has(ns))
        }

        const nsPromises = namespaces.map(async (ns) => {
          const nsParam = ns ? `?ns=${encodeURIComponent(ns)}` : ''
          const snapshots = await pbsFetch<any[]>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/snapshots${nsParam}`)


return (snapshots || []).map(snap => ({
            backupTime: snap['backup-time'] || 0,
            backupType: snap['backup-type'] || 'unknown',
            size: snap.size || 0,
            verified: snap.verification?.state === 'ok',
          }))
        })

        return (await Promise.all(nsPromises)).flat()
      } catch {
        return []
      }
    })

    const results = await Promise.all(dsPromises)

    results.forEach(backups => allBackups.push(...backups))

    // Build daily aggregation for the last N days
    const now = new Date()
    const cutoff = new Date(now)

    cutoff.setDate(cutoff.getDate() - days)
    cutoff.setHours(0, 0, 0, 0)
    const cutoffTs = Math.floor(cutoff.getTime() / 1000)

    // Initialize all days
    const dailyMap = new Map<string, {
      date: string
      total: number
      vm: number
      ct: number
      host: number
      verified: number
      unverified: number
      size: number
    }>()

    for (let d = 0; d < days; d++) {
      const date = new Date(now)

      date.setDate(date.getDate() - d)
      const key = date.toISOString().slice(0, 10)

      dailyMap.set(key, { date: key, total: 0, vm: 0, ct: 0, host: 0, verified: 0, unverified: 0, size: 0 })
    }

    // Aggregate
    for (const b of allBackups) {
      if (b.backupTime < cutoffTs) continue

      const date = new Date(b.backupTime * 1000).toISOString().slice(0, 10)
      const entry = dailyMap.get(date)

      if (!entry) continue

      entry.total++
      if (b.backupType === 'vm') entry.vm++
      else if (b.backupType === 'ct') entry.ct++
      else if (b.backupType === 'host') entry.host++

      if (b.verified) entry.verified++
      else entry.unverified++

      entry.size += b.size
    }

    // Sort chronologically
    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    // Type distribution (all time, not just N days)
    const typeDistribution = {
      vm: allBackups.filter(b => b.backupType === 'vm').length,
      ct: allBackups.filter(b => b.backupType === 'ct').length,
      host: allBackups.filter(b => b.backupType === 'host').length,
    }

    return NextResponse.json({
      data: {
        daily,
        typeDistribution,
        totalBackups: allBackups.length,
        period: { days, from: cutoff.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
      }
    })
  } catch (e: any) {
    console.error("PBS backup trends error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
