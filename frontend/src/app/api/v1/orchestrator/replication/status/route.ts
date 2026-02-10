import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getReplicationHealth()

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching replication health:", e)

    return NextResponse.json({
      sites: [],
      connectivity: 'disconnected',
      latency_ms: 0,
      kpis: {
        protected_vms: 0,
        unprotected_vms: 0,
        avg_rpo_seconds: 0,
        last_sync: '',
        replicated_bytes: 0,
        error_count: 0
      },
      recent_activity: []
    })
  }
}
