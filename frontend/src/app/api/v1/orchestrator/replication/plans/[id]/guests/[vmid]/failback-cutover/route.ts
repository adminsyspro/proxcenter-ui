import { NextRequest } from "next/server"

import { proxyPlanGuestAction } from "@/lib/orchestrator/planGuestActionProxy"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// Cutover of ONE guest's failback (ui#943): stop the DR replica, apply the
// final delta, start the source VM and protect the guest again.
async function handlePost(_request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  return proxyPlanGuestAction(params, undefined, {
    action: (client, id, vmid) => client.guestFailbackCutover(id, vmid),
    auditAction: "dr.guest_failback_cutover",
    fallbackMessage: "Failed to start the guest failback cutover",
  })
}

export const POST = withAudit({ category: "replication", resourceType: "guest", resourceParam: "vmid", action: "failback" }, handlePost)
