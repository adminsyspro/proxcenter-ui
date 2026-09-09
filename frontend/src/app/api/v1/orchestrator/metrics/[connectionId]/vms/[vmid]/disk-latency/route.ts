// src/app/api/v1/orchestrator/metrics/[connectionId]/vms/[vmid]/disk-latency/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission } from "@/lib/rbac"
import { resolveRrdScope } from "@/lib/rbac/rrdScope"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ connectionId: string; vmid: string }>
}

// GET /api/v1/orchestrator/metrics/:connectionId/vms/:vmid/disk-latency?node=&from=&to=&step=
//
// The guest's disk latency history the Disk I/O chart draws (#881). Gated like
// the RRD proxy, on vm.view for that very guest, so a VM-scoped user who sees
// the performance charts sees the latency curve with them; the other metrics
// routes require automation.view and would 403 them.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { connectionId, vmid } = await params
    const { searchParams } = new URL(request.url)
    const node = searchParams.get("node") || ""
    const from = searchParams.get("from") || undefined
    const to = searchParams.get("to") || undefined
    const stepRaw = Number(searchParams.get("step"))
    const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.round(stepRaw) : undefined

    if (!node || !/^\d+$/.test(vmid)) {
      return NextResponse.json({ error: "Missing node or invalid vmid" }, { status: 400 })
    }

    const scope = resolveRrdScope(connectionId, `/nodes/${node}/qemu/${vmid}`)
    if (!scope) return NextResponse.json({ error: "Invalid scope" }, { status: 400 })

    const denied = await checkPermission(scope.permission, scope.resourceType, scope.resourceId)
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(connectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.getVMDiskLatencySeries(connectionId, vmid, { from, to, step })

    return NextResponse.json(response.data || { step: step ?? 60, points: [] })
  } catch (e: any) {
    if ((e as any)?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Error fetching disk latency history:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch disk latency history" },
      { status: 500 }
    )
  }
}
