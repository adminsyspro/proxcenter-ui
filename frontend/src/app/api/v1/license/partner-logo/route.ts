import { NextResponse } from "next/server"

import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

// The logo of the partner that delivered the connected license (License tab).
// Read from the orchestrator, which received it at check-in: the browser never
// contacts proxcenter.io. Same access as /api/v1/license/status.
export async function GET(request: Request) {
  const notFound = () => NextResponse.json({ error: "No partner logo" }, { status: 404, headers: { "Cache-Control": "no-store" } })

  try {
    const ifNoneMatch = request.headers.get("if-none-match")
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/connection/partner-logo`, {
      headers: orchestratorHeaders(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
      cache: "no-store",
    })
    const etag = res.headers.get("etag")

    if (res.status === 304) return new NextResponse(null, { status: 304, headers: etag ? { ETag: etag } : {} })
    const type = (res.headers.get("content-type") || "").split(";")[0].trim()

    if (!res.ok || !LOGO_TYPES.has(type)) return notFound()

    return new NextResponse(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        ...(etag ? { ETag: etag } : {}),
      },
    })
  } catch {
    return notFound()
  }
}
