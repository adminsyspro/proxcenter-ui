import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * Returns backup trends aggregated by day for the last N days.
 * Query params: days (default 30)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const url = new URL(req.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90)

    const conn = await getPbsConnectionById(id)

    // Fetch all datastores
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

    // Fetch all snapshots from all datastores
    const allBackups: any[] = []

    const dsPromises = (datastores || []).map(async (ds) => {
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
