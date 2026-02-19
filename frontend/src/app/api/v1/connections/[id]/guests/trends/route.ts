// src/app/api/v1/connections/[id]/guests/trends/route.ts
import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

type TrendRequestItem = {
  type: "qemu" | "lxc" | string
  node: string
  vmid: string | number
}

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n))
}

function normType(t: any) {
  return String(t ?? "").toLowerCase()
}

function normNode(n: any) {
  return String(n ?? "")
}

function normVmid(v: any) {
  return String(v ?? "")
}

function makeKey(type: any, node: any, vmid: any) {
  return `${normType(type)}:${normNode(node)}:${normVmid(vmid)}`
}

function formatHHMM(tsSec: number) {
  const d = new Date(tsSec * 1000)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")

  
return `${hh}:${mm}`
}

function rrdHasCpuOrMem(rrd: any[]) {
  const arr = Array.isArray(rrd) ? rrd : []

  
return arr.some(
    p =>
      p &&
      (p.cpu !== undefined ||
        p.mem !== undefined ||
        p.memused !== undefined ||
        p.maxmem !== undefined)
  )
}

function toTrendPoints(rrd: any[]) {
  const arr = Array.isArray(rrd) ? rrd : []

  // Prendre les 180 derniers points (~3h de données avec résolution ~1min)
  const tail = arr.filter(p => p && typeof p.time === "number").slice(-180)

  return tail.map(p => {
    const cpuPct = Math.round(clampPct(Number(p.cpu || 0) * 100))

    let ramPct = 0
    const mem = Number(p.mem ?? p.memused ?? 0)
    const maxmem = Number(p.maxmem ?? p.memtotal ?? 0)

    if (maxmem > 0) ramPct = Math.round(clampPct((mem / maxmem) * 100))

    const netin = Number(p.netin ?? 0)
    const netout = Number(p.netout ?? 0)

    return {
      t: formatHHMM(Number(p.time)),
      cpu: cpuPct,
      ram: ramPct,
      ...(netin > 0 || netout > 0 ? { netin, netout } : {}),
    }
  })
}

function singlePointNow(cpuPct: number, ramPct: number) {
  const now = Math.floor(Date.now() / 1000)

  
return [{ t: formatHHMM(now), cpu: cpuPct, ram: ramPct }]
}

async function tryStatusCurrent(conn: any, type: string, node: string, vmid: string) {
  const base = `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}`

  const cur = await pveFetch<any>(
    conn,  // ✅ Passer conn directement (contient baseUrl, apiToken, insecureDev)
    `${base}/status/current`,
    { method: "GET" }
  )

  const cpuPct = Math.round(clampPct(Number(cur?.cpu ?? 0) * 100))
  const mem = Number(cur?.mem ?? 0)
  const maxmem = Number(cur?.maxmem ?? 0)
  const ramPct = maxmem > 0 ? Math.round(clampPct((mem / maxmem) * 100)) : 0

  return { cpuPct, ramPct }
}

async function tryGuestsFallback(appBaseUrl: string, connId: string, type: string, node: string, vmid: string) {
  const url = `${appBaseUrl}/api/v1/connections/${encodeURIComponent(connId)}/guests`
  const res = await fetch(url, { method: "GET", cache: "no-store" })
  const txt = await res.text()
  let json: any = null

  try {
    json = JSON.parse(txt)
  } catch {
    // pas JSON
  }

  const arr = Array.isArray(json?.data) ? json.data : []

  const hit = arr.find(
    (g: any) => normType(g.type) === type && normNode(g.node) === node && normVmid(g.vmid) === vmid
  )

  if (!hit) return { ok: false, status: res.status, url, why: "vm_not_found_in_guests", sampleLen: arr.length }

  const cpuPct = Math.round(clampPct(Number(hit.cpu ?? 0) * 100))
  const mem = Number(hit.mem ?? 0)
  const maxmem = Number(hit.maxmem ?? 0)
  const ramPct = maxmem > 0 ? Math.round(clampPct((mem / maxmem) * 100)) : 0

  return { ok: true, status: res.status, url, cpuPct, ramPct }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const debug = req.headers.get("x-debug") === "1"

  const conn = await getConnectionById(id)

  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 404 })

  const body = (await req.json().catch(() => null)) as
    | { items?: TrendRequestItem[]; timeframe?: string }
    | null

  const items = Array.isArray(body?.items) ? body!.items! : []
  const timeframe = body?.timeframe ?? "hour"

  if (items.length === 0) return NextResponse.json({ data: {} })

  const host = req.headers.get("host") || "localhost:3000"
  const proto = req.headers.get("x-forwarded-proto") || "http"
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`

  const out: Record<string, any[]> = {}
  const dbg: any[] = []

  // Traiter tous les items EN PARALLÈLE au lieu de séquentiellement
  const results = await Promise.allSettled(
    items.map(async (it) => {
      const type = normType(it.type)
      const node = normNode(it.node)
      const vmid = normVmid(it.vmid)
      const key = makeKey(type, node, vmid)

      const entry: any = { key, asked: { type, node, vmid }, steps: [] as any[] }

      if (!type || !node || !vmid) {
        entry.steps.push({ step: "validate", ok: false })
        
return { key, data: [], entry }
      }

      // 1) rrddata
      try {
        const base = `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}`
        let rrd = await pveFetch<any[]>(
          conn,
          `${base}/rrddata?timeframe=${encodeURIComponent(timeframe)}&cf=AVERAGE`,
          { method: "GET" }
        )

        if (timeframe === "hour" && (!rrd || rrd.length === 0)) {
          rrd = await pveFetch<any[]>(
            conn,
            `${base}/rrddata?timeframe=day&cf=AVERAGE`,
            { method: "GET" }
          )
          entry.steps.push({ step: "rrd_hour_empty_fallback_day", ok: true, points: rrd?.length ?? 0 })
        } else {
          entry.steps.push({ step: "rrd", ok: true, points: rrd?.length ?? 0 })
        }

        if (rrd && rrd.length > 0 && rrdHasCpuOrMem(rrd)) {
          const data = toTrendPoints(rrd)

          entry.steps.push({ step: "use_rrd", ok: true, outPoints: data.length })
          
return { key, data, entry }
        }

        entry.steps.push({ step: "rrd_not_usable", ok: true })
      } catch (e: any) {
        entry.steps.push({ step: "rrd_error", ok: false, err: String(e?.message ?? e) })
      }

      // 2) fallback status/current
      try {
        const cur = await tryStatusCurrent(conn, type, node, vmid)
        const data = singlePointNow(cur.cpuPct, cur.ramPct)

        entry.steps.push({ step: "status_current", ok: true, cpu: cur.cpuPct, ram: cur.ramPct })
        
return { key, data, entry }
      } catch (e: any) {
        entry.steps.push({ step: "status_current_error", ok: false, err: String(e?.message ?? e) })
      }

      // 3) fallback /guests (interne) - SKIP this as it's very slow
      // Just return empty data instead of calling the slow /guests endpoint
      entry.steps.push({ step: "fallback_skipped", ok: false })
      
return { key, data: [], entry }
    })
  )

  // Collecter les résultats
  for (const result of results) {
    if (result.status === 'fulfilled') {
      out[result.value.key] = result.value.data
      if (debug) dbg.push(result.value.entry)
    }
  }

  if (debug) return NextResponse.json({ data: out, debug: { appBaseUrl, items: dbg } })
  
return NextResponse.json({ data: out })
}
