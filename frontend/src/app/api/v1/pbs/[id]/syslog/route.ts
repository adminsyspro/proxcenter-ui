import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type SyslogSource = "journal" | "syslog"

function isNotFound(err: any): boolean {
  const msg = String(err?.message || err || "")
  return /\b404\b/.test(msg)
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const url = new URL(req.url)
    const sp = url.searchParams

    const rawLast = parseInt(sp.get("lastentries") || "500", 10)
    const lastentries = Math.max(1, Math.min(5000, isNaN(rawLast) ? 500 : rawLast))

    const sinceRaw = sp.get("since") || ""
    const untilRaw = sp.get("until") || ""
    const service = (sp.get("service") || "").trim()

    const sinceSec = sinceRaw ? parseInt(sinceRaw, 10) : NaN
    const untilSec = untilRaw ? parseInt(untilRaw, 10) : NaN

    let lines: string[] = []
    let source: SyslogSource = "journal"

    // Try /nodes/localhost/journal first (PBS 3+)
    const journalQs = new URLSearchParams()
    journalQs.set("lastentries", String(lastentries))
    if (!isNaN(sinceSec)) journalQs.set("since", String(sinceSec))
    if (!isNaN(untilSec)) journalQs.set("until", String(untilSec))

    try {
      const journal = await pbsFetch<string[]>(
        conn,
        `/nodes/localhost/journal?${journalQs.toString()}`
      )
      lines = Array.isArray(journal) ? journal.map(l => String(l)) : []
      source = "journal"
    } catch (e: any) {
      if (!isNotFound(e)) {
        throw e
      }

      // Fallback to legacy /syslog endpoint
      const syslogQs = new URLSearchParams()
      syslogQs.set("start", "0")
      syslogQs.set("limit", String(lastentries))
      if (!isNaN(sinceSec)) syslogQs.set("since", String(sinceSec))
      if (!isNaN(untilSec)) syslogQs.set("until", String(untilSec))

      const legacy = await pbsFetch<Array<{ n: number; t: string }>>(
        conn,
        `/nodes/localhost/syslog?${syslogQs.toString()}`
      )
      lines = Array.isArray(legacy) ? legacy.map(row => String(row?.t ?? "")) : []
      source = "syslog"
    }

    if (service) {
      const needle = service.toLowerCase()
      lines = lines.filter(l => l.toLowerCase().includes(needle))
    }

    return NextResponse.json({ data: { lines, source } })
  } catch (e: any) {
    console.error("PBS syslog error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
