import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

const ALLOWED_ACTIONS = ["start", "stop", "restart", "reload"] as const

type AllowedAction = (typeof ALLOWED_ACTIONS)[number]

function isAllowedAction(value: string): value is AllowedAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(value)
}

export async function POST(
  req: Request,
  ctx: {
    params:
      | Promise<{ id: string; service: string; action: string }>
      | { id: string; service: string; action: string }
  }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const service = (params as any)?.service
    const action = (params as any)?.action

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    if (!service || typeof service !== "string" || service.trim().length === 0) {
      return NextResponse.json({ error: "Invalid service name" }, { status: 400 })
    }

    if (!action || !isAllowedAction(String(action))) {
      return NextResponse.json(
        { error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(", ")}` },
        { status: 400 }
      )
    }

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const upid = await pbsFetch<string>(
      conn,
      `/nodes/localhost/services/${encodeURIComponent(service)}/${action}`,
      { method: "POST" }
    )

    return NextResponse.json({ data: { upid } })
  } catch (e: any) {
    console.error("PBS services error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
