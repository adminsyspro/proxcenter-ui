import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET - List all metric servers
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const servers = await pveFetch<any[]>(conn, "/cluster/metrics/server")
    return NextResponse.json({ data: servers || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Create a metric server
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()
    const { serverId, type, ...params } = body

    if (!serverId) {
      return NextResponse.json({ error: "Missing serverId" }, { status: 400 })
    }

    // PVE: POST /cluster/metrics/server/{id} — the server id goes in the URL,
    // not in the form body. Posting to /cluster/metrics/server returns 501.
    const createParams = new URLSearchParams()
    createParams.set('type', type)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      // PVE rejects JS booleans ('true'/'false'); it wants 1/0 for boolean fields.
      const serialized = typeof v === 'boolean' ? (v ? '1' : '0') : String(v)
      createParams.set(k, serialized)
    }

    await pveFetch<any>(conn, `/cluster/metrics/server/${encodeURIComponent(serverId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
