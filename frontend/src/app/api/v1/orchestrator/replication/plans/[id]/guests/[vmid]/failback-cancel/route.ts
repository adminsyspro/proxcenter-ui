import { NextRequest } from "next/server"

import { proxyPlanGuestAction } from "@/lib/orchestrator/planGuestActionProxy"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// Cancel of ONE guest's failback (ui#943): reverse replication stops, the
// guest stays failed over, nothing is changed on either VM.
async function handlePost(_request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  return proxyPlanGuestAction(params, undefined, {
    action: (client, id, vmid) => client.guestFailbackCancel(id, vmid),
    auditAction: "dr.guest_failback_cancel",
    fallbackMessage: "Failed to cancel the guest failback",
  })
}

export const POST = withAudit({ category: "replication", resourceType: "guest", resourceParam: "vmid", action: "cancel" }, handlePost)
