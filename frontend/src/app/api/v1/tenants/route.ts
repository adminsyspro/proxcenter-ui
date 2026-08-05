export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listTenants, createTenant, requireProviderTenant } from "@/lib/tenant"
import { parseVmidRangeInput, findVmidRangeConflict } from "@/lib/tenant/vmidRange"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

// GET /api/v1/tenants — list all tenants (admin only)
export async function GET() {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const tenants = await listTenants()
  return NextResponse.json({ data: tenants })
}

// POST /api/v1/tenants — create a new tenant
export async function POST(req: NextRequest) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const session = await getServerSession(authOptions)
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

  // Optional MSP VMID range (both bounds or none; MSP only; no overlap
  // with another tenant's range).
  const rangeParse = parseVmidRangeInput(body)
  if (!rangeParse.ok) {
    return NextResponse.json({ error: rangeParse.error }, { status: 400 })
  }
  const vmidRange = rangeParse.range ?? null
  if (vmidRange) {
    if (body.operatingModel !== 'msp') {
      return NextResponse.json({ error: "A VMID range is only available for MSP tenants" }, { status: 400 })
    }
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
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "A tenant with this slug already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
