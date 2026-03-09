import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/aplinfo
// List available CT templates from the online repository
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)

    const data = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/aplinfo`
    )

    return NextResponse.json({ data: data || [] })
  } catch (e: any) {
    console.error("Error fetching aplinfo:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/connections/{id}/nodes/{node}/aplinfo
// Download a CT template to a storage
// Body: { storage: string, template: string }
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.STORAGE_UPLOAD, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const body = await req.json()
    const { storage, template } = body

    if (!storage || !template) {
      return NextResponse.json({ error: "storage and template are required" }, { status: 400 })
    }

    const data = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/aplinfo`,
      {
        method: "POST",
        body: new URLSearchParams({ storage, template }),
      }
    )

    await audit({
      action: "import",
      category: "storage",
      resourceType: "storage",
      resourceId: storage,
      details: { node, template },
    })

    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    console.error("Error downloading template:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
