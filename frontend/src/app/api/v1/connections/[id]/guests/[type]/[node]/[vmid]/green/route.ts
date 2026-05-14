import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveGreenConfigForNode } from "@/lib/green/resolve"
import { computeGreenMetricsForVms, type GreenConfig } from "@/lib/green/compute"
import { detectInsight } from "@/lib/green/insights"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; type: string; node: string; vmid: string }>
}

/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/green?days=30
 *
 * Returns the VM's 30-day energy/cost/CO² aggregate and one actionable
 * insight (or null), computed from PVE's native RRD month timeframe.
 * Falls back to {hasEnoughData: false} when fewer than 12 samples land
 * inside the window (typically: VM created less than 48h ago).
 */
export async function GET(req: Request, ctx: RouteContext) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const { id, type: typeRaw, node, vmid } = await ctx.params
    const type = typeRaw === "lxc" ? "lxc" : "qemu"
    const url = new URL(req.url)

    let days = Number.parseInt(url.searchParams.get("days") || "30", 10)

    if (!Number.isFinite(days) || days < 1) days = 30
    if (days > 30) days = 30

    if (!id || !vmid || !node) {
      return NextResponse.json({ error: "Missing id, vmid or node" }, { status: 400 })
    }

    const vmResourceId = `${id}:${type}:${node}:${vmid}`
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", vmResourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    const rrdPath = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/rrddata?timeframe=month&cf=AVERAGE`
    let raw: any[] = []

    try {
      raw = (await pveFetch<any[]>(conn, rrdPath)) || []
    } catch {
      raw = []
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const cutoff = nowSec - days * 86400
    const samples = raw.filter((p) => typeof p?.time === "number" && p.time >= cutoff)

    if (samples.length < 12) {
      return NextResponse.json({
        hasEnoughData: false,
        windowDays: days,
        samples: { count: samples.length, fromTs: 0, toTs: 0, avgCpuPct: 0, avgMemPct: 0, runningRatio: 0 },
        metrics: null,
        insight: null,
      })
    }

    let cpuSum = 0
    let memPctSum = 0
    let runningCount = 0
    let maxcpu = 0
    let maxmem = 0
    let fromTs = Infinity
    let toTs = 0

    for (const p of samples) {
      const cpu = Number(p.cpu) || 0
      const mem = Number(p.mem) || 0
      const mc = Number(p.maxcpu) || 0
      const mm = Number(p.maxmem) || 0

      if (p.time < fromTs) fromTs = p.time
      if (p.time > toTs) toTs = p.time
      const running = cpu > 0 || mem > 0

      if (running) {
        runningCount++
        cpuSum += cpu
        if (mm > 0) memPctSum += (mem / mm) * 100
        if (mc > maxcpu) maxcpu = mc
        if (mm > maxmem) maxmem = mm
      }
    }

    const runningRatio = runningCount > 0 ? runningCount / samples.length : 0
    const avgCpuPct = runningCount > 0 ? (cpuSum / runningCount) * 100 : 0
    const avgMemPct = runningCount > 0 ? memPctSum / runningCount : 0

    const resolved = await resolveGreenConfigForNode(id, node)

    const config: GreenConfig = {
      tdpPerCore: resolved.tdpPerCore,
      wattsPerGbRam: resolved.wattsPerGbRam,
      pue: resolved.datacenter.pue,
      co2Factor: resolved.datacenter.co2Factor,
      electricityPrice: resolved.datacenter.electricityPrice,
      currency: resolved.datacenter.currency,
      equivalences: { kmVoiture: 0.193, arbreParAn: 25, chargeSmartphone: 0.0085 },
    }

    const baseMetrics = computeGreenMetricsForVms(
      [{ vcpus: maxcpu, ramBytes: maxmem, status: "running", cpuPct: avgCpuPct / 100, config }],
      config,
    )

    // Scale by runningRatio to reflect actual time-on within the window.
    const metrics = {
      ...baseMetrics,
      power: {
        ...baseMetrics.power,
        current: Math.round(baseMetrics.power.current * runningRatio),
        monthly: Math.round(baseMetrics.power.monthly * runningRatio),
        yearly: Math.round(baseMetrics.power.yearly * runningRatio),
      },
      co2: {
        ...baseMetrics.co2,
        hourly: Math.round(baseMetrics.co2.hourly * runningRatio * 1000) / 1000,
        daily: Math.round(baseMetrics.co2.daily * runningRatio * 100) / 100,
        monthly: Math.round(baseMetrics.co2.monthly * runningRatio * 10) / 10,
        yearly: Math.round(baseMetrics.co2.yearly * runningRatio),
        equivalentKmCar: Math.round(baseMetrics.co2.equivalentKmCar * runningRatio),
        equivalentTrees: Math.round(baseMetrics.co2.equivalentTrees * runningRatio * 100) / 100,
      },
      cost: {
        ...baseMetrics.cost,
        hourly: Math.round(baseMetrics.cost.hourly * runningRatio * 100) / 100,
        daily: Math.round(baseMetrics.cost.daily * runningRatio * 100) / 100,
        monthly: Math.round(baseMetrics.cost.monthly * runningRatio),
        yearly: Math.round(baseMetrics.cost.yearly * runningRatio),
      },
    }

    const insight = detectInsight({
      avgCpuPct,
      avgMemPct,
      runningRatio,
      pue: resolved.datacenter.pue,
      maxcpu,
    })

    return NextResponse.json({
      hasEnoughData: true,
      windowDays: days,
      samples: {
        count: samples.length,
        fromTs,
        toTs,
        avgCpuPct: Math.round(avgCpuPct * 10) / 10,
        avgMemPct: Math.round(avgMemPct * 10) / 10,
        runningRatio: Math.round(runningRatio * 1000) / 1000,
      },
      metrics,
      insight,
    })
  } catch (e: any) {
    console.error("[green/vm] Error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
