export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listTenants, createTenant, requireProviderTenant } from "@/lib/tenant"
import { tenantWriteFailure } from "@/lib/tenant/writeFailure"
import { parseVmidRangeInput, findVmidRangeConflict } from "@/lib/tenant/vmidRange"
import { audit } from "@/lib/audit"
import { syncServiceDeskForNewTenant } from "@/lib/rbac/serviceDesk"
import { getActingSession } from "@/lib/auth/actingUser"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

// GET /api/v1/tenants — list all tenants (admin only; API tokens: tenants:read)
async function handleGet() {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS_VIEW)
  if (denied) return denied

  const tenants = await listTenants()
  return NextResponse.json({ data: tenants })
}

export const GET = withPublicApiGuard("tenants-list", handleGet)

// POST /api/v1/tenants — create a new tenant
async function handlePost(req: Request) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const session = await getActingSession()
  const body = await req.json()

  if (!body.name || !body.slug) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return NextResponse.json({ error: "slug must contain only lowercase letters, numbers, and hyphens" }, { status: 400 })
  }

  // v1.5: optional operating model. Accept only the two valid values; the
  // default ('iaas') is applied in createTenant. The selector UI ships later.
  if (body.operatingModel !== undefined && !['iaas', 'msp'].includes(body.operatingModel)) {
    return NextResponse.json({ error: "operatingModel must be 'iaas' or 'msp'" }, { status: 400 })
  }

  // Optional VMID range (both bounds or none; msp and iaas tenants alike;
  // no overlap with another tenant's range).
  const rangeParse = parseVmidRangeInput(body)
  if (!rangeParse.ok) {
    return NextResponse.json({ error: rangeParse.error }, { status: 400 })
  }
  const vmidRange = rangeParse.range ?? null
  if (vmidRange) {
    const conflict = await findVmidRangeConflict(vmidRange.start, vmidRange.end)
    if (conflict) {
      return NextResponse.json(
        { error: `VMID range overlaps the range of tenant "${conflict.name}"` },
        { status: 409 }
      )
    }
  }

  try {
    const tenant = await createTenant({
      slug: body.slug,
      name: body.name,
      description: body.description,
      createdBy: session?.user?.id,
      operatingModel: body.operatingModel,
      vmidRangeStart: vmidRange?.start ?? null,
      vmidRangeEnd: vmidRange?.end ?? null,
    })

    // Service-desk roles published to all tenants reach the new one (ui#1336).
    await syncServiceDeskForNewTenant()

    await audit({
      action: "tenant.create",
      category: "admin",
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      resourceType: "tenant",
      resourceId: tenant.id,
      resourceName: tenant.name,
      status: "success",
    })

    return NextResponse.json({ data: tenant }, { status: 201 })
  } catch (e) {
    return tenantWriteFailure(e, "create")
  }
}

export const POST = withAudit({ category: "admin", resourceType: "tenant" }, withPublicApiGuard("tenant-create", handlePost))
