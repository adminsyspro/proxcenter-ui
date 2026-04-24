import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type EndpointType = "smtp" | "sendmail" | "gotify" | "webhook"

const ENDPOINT_TYPES: EndpointType[] = ["smtp", "sendmail", "gotify", "webhook"]

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const results = await Promise.allSettled(
      ENDPOINT_TYPES.map(kind => pbsFetch<any[]>(conn, `/config/notifications/endpoints/${kind}`))
    )

    const endpoints: any[] = []

    results.forEach((result, idx) => {
      const kind = ENDPOINT_TYPES[idx]

      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        for (const e of result.value) {
          endpoints.push({ ...e, type: kind })
        }
      }
    })

    return NextResponse.json({ data: endpoints })
  } catch (e: any) {
    console.error("PBS notifications/endpoints GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
