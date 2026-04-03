import { NextResponse } from "next/server"

import { triggerPoll } from "@/lib/cache/inventoryPoller"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

/**
 * POST /api/v1/inventory/poll
 *
 * Triggers an immediate inventory poll cycle. Called after user actions
 * (VM start/stop, config change, etc.) to speed up SSE event delivery
 * instead of waiting for the next 10s poll interval.
 */
export async function POST(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
  if (denied) return denied

  triggerPoll()
  return NextResponse.json({ ok: true })
}
