import { NextRequest } from "next/server"

import { proxyPlanGuestAction } from "@/lib/orchestrator/planGuestActionProxy"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// Failback of ONE failed-over guest (ui#943): reverse replication from the
// DR site to the source until its cutover.
async function handlePost(_request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  return proxyPlanGuestAction(params, undefined, {
    action: (client, id, vmid) => client.guestFailback(id, vmid),
    auditAction: "dr.guest_failback",
    fallbackMessage: "Failed to start the guest failback",
  })
}

export const POST = withAudit({ category: "replication", resourceType: "guest", resourceParam: "vmid", action: "failback" }, handlePost)
