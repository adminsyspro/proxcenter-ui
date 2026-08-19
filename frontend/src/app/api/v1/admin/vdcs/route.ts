import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listVdcs, createVdc } from "@/lib/vdc"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { audit } from "@/lib/audit"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/admin/vdcs — list all vDCs (optionally filtered by ?tenantId=xxx)
export async function GET(req: NextRequest) {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = req.nextUrl.searchParams.get("tenantId") || undefined
    const vdcs = await listVdcs(tenantId)

    return NextResponse.json({ data: vdcs })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/admin/vdcs — create a vDC
export async function POST(req: NextRequest) {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const body = await req.json()

    // Validate required fields
    if (!body.tenantId || !body.connectionId || !body.name || !body.slug) {
      return NextResponse.json(
        { error: "tenantId, connectionId, name, and slug are required" },
        { status: 400 }
      )
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(body.slug)) {
      return NextResponse.json(
        { error: "slug must contain only lowercase letters, numbers, and hyphens" },
        { status: 400 }
      )
    }

    // Validate nodes and storages
    if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
      return NextResponse.json(
        { error: "nodes must be a non-empty array" },
        { status: 400 }
      )
    }

    if (typeof body.primaryStorage !== "string" || !body.primaryStorage.trim()) {
      return NextResponse.json(
        { error: "primaryStorage is required (a single shared storage advertising content=images)" },
        { status: 400 }
      )
    }

    const vdc = await createVdc(
      {
        tenantId: body.tenantId,
        connectionId: body.connectionId,
        name: body.name,
        slug: body.slug,
        description: body.description,
        nodes: body.nodes,
        primaryStorage: body.primaryStorage.trim(),
        // Same bug as the PUT route: the body carried sharedBridges but
        // the call site dropped it, so a brand-new vDC was created with
        // an empty uplink list regardless of what the form sent.
        sharedBridges: body.sharedBridges,
        vlanPools: body.vlanPools,
        quota: body.quota,
      },
      session?.user?.id ?? null
    )

    await audit({
      action: "create",
      category: "settings",
      resourceType: "vdc",
      resourceId: vdc.id,
      resourceName: vdc.name,
      details: {
        tenantId: body.tenantId,
        connectionId: body.connectionId,
        slug: body.slug,
        nodes: body.nodes,
        primaryStorage: body.primaryStorage,
      },
      status: "success",
    })

    return NextResponse.json({ data: vdc }, { status: 201 })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
