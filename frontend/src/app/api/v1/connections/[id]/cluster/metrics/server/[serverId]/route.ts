import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET - Get a specific metric server
export async function GET(req: Request, ctx: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await ctx.params
    if (!id || !serverId) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const server = await pveFetch<any>(conn, `/cluster/metrics/server/${encodeURIComponent(serverId)}`)
    return NextResponse.json({ data: server || {} })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Update a metric server
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await ctx.params
    if (!id || !serverId) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    const deleteFields: string[] = []
    for (const [k, v] of Object.entries(body)) {
      if (k === 'delete' || k === 'serverId' || k === 'id') continue
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }
    if (body.delete) updateParams.set('delete', String(body.delete))

    await pveFetch<any>(conn, `/cluster/metrics/server/${encodeURIComponent(serverId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE - Delete a metric server
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await ctx.params
    if (!id || !serverId) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    await pveFetch<any>(conn, `/cluster/metrics/server/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
