import { NextResponse } from "next/server"

import { getServerLicense } from "@/lib/auth/requireEnterprise"
import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
   Ceph history (Enterprise). In Community the route does not exist as far as
   the client can tell: 404 without calling the orchestrator, and also when the
   orchestrator itself answers with a license 403 (the edition changed between
   the two checks) or does not know the route yet (404).
*/

const RANGES: Record<string, { seconds: number; step: number }> = {
  "1h": { seconds: 3600, step: 60 },
  "24h": { seconds: 86_400, step: 300 },
  "7d": { seconds: 604_800, step: 1800 },
  "30d": { seconds: 2_592_000, step: 7200 },
}

const MAX_TOP = 50
const MAX_OSDS = 100

type Ctx = { params: Promise<{ connectionId: string }> }

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

/** GET /api/v1/orchestrator/ceph/[connectionId]/history?range=1h|24h|7d|30d&top=&osds=0,1,2&osd_io=1 -> { data: CephHistory } */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { connectionId } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", connectionId)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(connectionId)) return notFound()

    const license = await getServerLicense()
    if (!license.enterprise) return notFound()

    const { searchParams } = new URL(req.url)
    const range = RANGES[searchParams.get("range") ?? ""]
    if (!range) {
      return NextResponse.json({ error: "range must be 1h, 24h, 7d or 30d" }, { status: 400 })
    }
    const topRaw = searchParams.get("top")
    let top: number | undefined
    if (topRaw !== null) {
      top = Number(topRaw)
      if (!Number.isInteger(top) || top < 1 || top > MAX_TOP) {
        return NextResponse.json({ error: `top must be an integer between 1 and ${MAX_TOP}` }, { status: 400 })
      }
    }

    // `osds`: distinct non-negative integers, at most 100, in the order given. Anything else is a 400.
    const osdsRaw = searchParams.get("osds")
    let osds: number[] | undefined
    if (osdsRaw !== null) {
      const parts = osdsRaw.split(",")
      if (!parts.every(p => /^\d{1,9}$/.test(p))) {
        return NextResponse.json({ error: "osds must be a comma separated list of non-negative integers" }, { status: 400 })
      }
      osds = [...new Set(parts.map(Number))]
      if (osds.length > MAX_OSDS) {
        return NextResponse.json({ error: `osds must hold at most ${MAX_OSDS} distinct ids` }, { status: 400 })
      }
    }

    // `osd_io=1`: per-OSD I/O rates from the ceph-exporter, only meaningful with `osds` (the orchestrator answers 400 otherwise).
    const osdIoRaw = searchParams.get("osd_io")
    if (osdIoRaw !== null && osdIoRaw !== "1") {
      return NextResponse.json({ error: "osd_io must be 1" }, { status: 400 })
    }
    const osdIo = osdIoRaw === "1"
    if (osdIo && !osds) {
      return NextResponse.json({ error: "osd_io requires osds" }, { status: 400 })
    }

    const now = Date.now()
    const response = await getOrchestratorClient().getCephHistory(connectionId, {
      from: new Date(now - range.seconds * 1000).toISOString(),
      to: new Date(now).toISOString(),
      step: range.step,
      top,
      osds,
      osdIo: osdIo || undefined,
    })

    return NextResponse.json({ data: response.data })
  } catch (e: any) {
    if (e?.code === "ORCHESTRATOR_UNAVAILABLE") {
      return NextResponse.json({ error: "Orchestrator unavailable", code: "ORCHESTRATOR_UNAVAILABLE" }, { status: 503 })
    }
    if (/Orchestrator 403\b/.test(String(e?.message)) && /"?code"?\s*:\s*"LICENSE_\w+"/.test(String(e?.message))) {
      return notFound()
    }
    // An orchestrator older than the Ceph history answers 404 on the path: no history, not a failure.
    if (/^Orchestrator 404\b/.test(String(e?.message))) return notFound()
    console.error("[ceph/history] GET Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to read the Ceph history" }, { status: 500 })
  }
}
