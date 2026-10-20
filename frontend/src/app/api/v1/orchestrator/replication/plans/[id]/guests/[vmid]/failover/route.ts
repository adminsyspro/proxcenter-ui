import { NextRequest } from "next/server"

import { proxyPlanGuestAction } from "@/lib/orchestrator/planGuestActionProxy"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// Failover of ONE guest of a recovery plan (ui#943): its source is fenced
// and its replica takes over on the DR site, the other guests of the plan
// keep replicating.
async function handlePost(request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  // Only the restore point is relayed and audited: anything else in the body
  // is the caller's, and must neither reach the orchestrator nor the audit row.
  const raw = await request.json().catch(() => undefined)
  const restorePoint = typeof raw?.restore_point === "string" ? raw.restore_point.slice(0, 128) : ""
  const body = restorePoint ? { restore_point: restorePoint } : undefined

  return proxyPlanGuestAction(params, body, {
    action: (client, id, vmid, payload) => client.guestFailover(id, vmid, payload),
    auditAction: "dr.guest_failover",
    fallbackMessage: "Failed to fail the guest over",
  })
}

export const POST = withAudit({ category: "replication", resourceType: "guest", resourceParam: "vmid", action: "failover" }, handlePost)
