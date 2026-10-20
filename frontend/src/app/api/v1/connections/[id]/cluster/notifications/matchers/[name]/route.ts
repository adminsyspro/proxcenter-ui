import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// GET - Get a specific matcher
export async function GET(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await ctx.params
    if (!id || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const matcher = await pveFetch<any>(conn, `/cluster/notifications/matchers/${encodeURIComponent(name)}`)
    return NextResponse.json({ data: matcher || {} })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Create a matcher (POST goes to /matchers not /matchers/{name})
async function handlePost(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }

    await pveFetch<any>(conn, `/cluster/notifications/matchers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Update a matcher
async function handlePut(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await ctx.params
    if (!id || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }

    await pveFetch<any>(conn, `/cluster/notifications/matchers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE - Delete a matcher
async function handleDelete(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await ctx.params
    if (!id || !name) return NextResponse.json({ error: "Missing params" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    await pveFetch<any>(conn, `/cluster/notifications/matchers/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "cluster", resourceType: "matcher", resourceParam: "name" }, handlePost)
export const PUT = withAudit({ category: "cluster", resourceType: "matcher", resourceParam: "name" }, handlePut)
export const DELETE = withAudit({ category: "cluster", resourceType: "matcher", resourceParam: "name" }, handleDelete)
