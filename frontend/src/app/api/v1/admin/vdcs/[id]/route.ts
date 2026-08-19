import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getVdcById, updateVdc, deleteVdc } from "@/lib/vdc"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { audit } from "@/lib/audit"
import { requireProviderTenant } from "@/lib/tenant"
import { listBindingsForVdc } from "@/lib/db/vdcPbsBindings"
import { unbindFromVdc } from "@/lib/vdc/pbsOrchestrator"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/admin/vdcs/[id] — get vDC detail
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const vdc = await getVdcById(id)
    if (!vdc) {
      return NextResponse.json({ error: "vDC not found" }, { status: 404 })
    }

    return NextResponse.json({ data: vdc })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/admin/vdcs/[id] — update vDC
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const body = await req.json()

    const vdc = await updateVdc(id, {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      nodes: body.nodes,
      primaryStorage: typeof body.primaryStorage === 'string' && body.primaryStorage.trim()
        ? body.primaryStorage.trim()
        : undefined,
      // Forward sharedBridges so the VdcTab "Shared bridges (uplinks)"
      // checkbox actually persists. Previously dropped here, the next GET
      // returned the old value and the UI rolled back the change.
      sharedBridges: body.sharedBridges,
      vlanPools: body.vlanPools,
      storagePolicies: body.storagePolicies,
      quota: body.quota,
    })

    await audit({
      action: "update",
      category: "settings",
      resourceType: "vdc",
      resourceId: id,
      resourceName: vdc.name,
      details: {
        updatedFields: Object.keys(body).filter((k) => body[k] !== undefined),
      },
      status: "success",
    })

    return NextResponse.json({ data: vdc })
  } catch (e: any) {
    const msg = e?.message || String(e)

    if (msg.includes("not found")) {
      return NextResponse.json({ error: "vDC not found" }, { status: 404 })
    }

    const mapped = mapCreateVdcError(e)
    if (mapped.status !== 500) return NextResponse.json({ error: mapped.message }, { status: mapped.status })

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/v1/admin/vdcs/[id] — delete vDC
export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const session = await getServerSession(authOptions)

    // Get vDC name before deletion for audit log
    const existing = await getVdcById(id)
    if (!existing) {
      return NextResponse.json({ error: "vDC not found" }, { status: 404 })
    }

    // Cascade: unbind each PBS binding first (cleanup PVE pbs: storage + sub-token;
    // PBS namespace + its backups are preserved on purpose, see spec §5).
    for (const b of await listBindingsForVdc(id)) {
      try { await unbindFromVdc(b.id) }
      catch (e) { console.error(`[vdc-delete] pbs unbind ${b.id} failed:`, e) }
    }

    await deleteVdc(id)

    await audit({
      action: "delete",
      category: "settings",
      resourceType: "vdc",
      resourceId: id,
      resourceName: existing.name,
      details: {
        slug: existing.slug,
        tenantId: existing.tenantId,
        connectionId: existing.connectionId,
      },
      status: "success",
    })

    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    const msg = e?.message || String(e)

    if (msg.includes("not found")) {
      return NextResponse.json({ error: "vDC not found" }, { status: 404 })
    }

    // VMs still exist in pool
    if (msg.includes("Cannot delete vDC")) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
