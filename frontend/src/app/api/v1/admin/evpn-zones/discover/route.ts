import { NextRequest, NextResponse } from "next/server"

import { discoverEvpn } from "@/lib/vdc/evpnZones"
import { evpnFail, evpnGate } from "@/lib/vdc/evpnRouteGate"

export const runtime = "nodejs"

// GET /api/v1/admin/evpn-zones/discover?connectionIds=a,b
// What each cluster already runs: EVPN controllers, EVPN zones, node
// addresses and the nodes missing frr. Read on demand by the declaration form.
export async function GET(req: NextRequest) {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    const ids = (req.nextUrl.searchParams.get("connectionIds") || "")
      .split(",").map(s => s.trim()).filter(Boolean).slice(0, 50)
    return NextResponse.json({ data: ids.length > 0 ? await discoverEvpn(ids) : [] })
  } catch (e: any) {
    return evpnFail(e)
  }
}
