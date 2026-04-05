import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET - Récupérer les options du datacenter (inclut les notes/description)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)

    // Récupérer les options du datacenter
    const options = await pveFetch<any>(conn, "/cluster/options")

    return NextResponse.json({
      data: options || {}
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Mettre a jour les options du datacenter
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

    const body = await req.json()
    const conn = await getConnectionById(id)

    // Whitelist of accepted PVE datacenter option keys
    const ALLOWED_KEYS = [
      'description', 'keyboard', 'language', 'console', 'email_from',
      'http_proxy', 'max_workers', 'migration', 'migration_unsecure',
      'ha', 'mac_prefix', 'bwlimit', 'tag-style', 'u2f', 'webauthn',
      'crs', 'notify', 'next-id',
    ]

    const updateParams = new URLSearchParams()

    for (const key of ALLOWED_KEYS) {
      if (body[key] !== undefined) {
        updateParams.set(key, String(body[key]))
      }
    }

    // Handle delete operations - PVE uses 'delete' param with comma-separated key names
    if (body.delete) {
      updateParams.set('delete', String(body.delete))
    }

    if (updateParams.toString() === '') {
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 })
    }

    await pveFetch<any>(conn, "/cluster/options", {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: updateParams.toString(),
    })

    return NextResponse.json({
      data: { success: true }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
