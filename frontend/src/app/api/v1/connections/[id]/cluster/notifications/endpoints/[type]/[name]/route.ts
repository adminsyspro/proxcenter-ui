import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET - Get a specific endpoint
export async function GET(req: Request, ctx: { params: Promise<{ id: string; type: string; name: string }> }) {
  try {
    const { id, type, name } = await ctx.params
    if (!id || !type || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const endpoint = await pveFetch<any>(conn, `/cluster/notifications/endpoints/${encodeURIComponent(type)}/${encodeURIComponent(name)}`)
    return NextResponse.json({ data: endpoint || {} })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Create an endpoint
export async function POST(req: Request, ctx: { params: Promise<{ id: string; type: string; name: string }> }) {
  try {
    const { id, type } = await ctx.params
    if (!id || !type) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }

    await pveFetch<any>(conn, `/cluster/notifications/endpoints/${encodeURIComponent(type)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Update an endpoint
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; type: string; name: string }> }) {
  try {
    const { id, type, name } = await ctx.params
    if (!id || !type || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }

    await pveFetch<any>(conn, `/cluster/notifications/endpoints/${encodeURIComponent(type)}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE - Delete an endpoint
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; type: string; name: string }> }) {
  try {
    const { id, type, name } = await ctx.params
    if (!id || !type || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    await pveFetch<any>(conn, `/cluster/notifications/endpoints/${encodeURIComponent(type)}/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
