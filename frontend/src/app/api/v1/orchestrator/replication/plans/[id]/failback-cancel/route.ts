import { NextRequest } from "next/server"

import { proxyPlanFailbackAction } from "@/lib/orchestrator/planFailbackProxy"

export const runtime = "nodejs"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return proxyPlanFailbackAction(params, {
    action: (client, id) => client.failbackCancel(id),
    logLabel: "Error cancelling failback:",
    fallbackMessage: "Failed to cancel failback",
  })
}
