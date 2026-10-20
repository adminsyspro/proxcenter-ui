import { NextRequest } from "next/server"

import { proxyPlanFailbackAction } from "@/lib/orchestrator/planFailbackProxy"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handlePost(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return proxyPlanFailbackAction(params, {
    action: (client, id) => client.failbackCutover(id),
    logLabel: "Error executing failback cutover:",
    fallbackMessage: "Failed to execute failback cutover",
  })
}

export const POST = withAudit({ category: "replication", resourceType: "plan", resourceParam: "id", action: "failback" }, handlePost)
