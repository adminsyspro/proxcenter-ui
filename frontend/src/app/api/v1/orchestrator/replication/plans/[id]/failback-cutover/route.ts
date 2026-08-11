import { NextRequest } from "next/server"

import { proxyPlanFailbackAction } from "@/lib/orchestrator/planFailbackProxy"

export const runtime = "nodejs"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return proxyPlanFailbackAction(params, {
    action: (client, id) => client.failbackCutover(id),
    logLabel: "Error executing failback cutover:",
    fallbackMessage: "Failed to execute failback cutover",
  })
}
