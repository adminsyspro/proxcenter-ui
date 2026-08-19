// Shared provider-tenant + RBAC guard for the storage-policy admin routes
// (route.ts and [policyId]/route.ts). NOT a route itself: the app router
// only treats a file literally named route.ts as one, so colocating this
// here keeps both route files importing the same guard body instead of
// duplicating it (duplication would also trip the Sonar new-code gate).
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant, DEFAULT_TENANT_ID } from "@/lib/tenant"

// requireProviderTenant() rides on getCurrentTenantId(), whose stale-JWT /
// disabled-tenant fallbacks silently PROMOTE to the default tenant (known
// fail-open, 30 callers, fix pending). A brand-new sensitive write surface
// must not inherit that: also require the RAW session tenant to be exactly
// the provider tenant.
export async function storagePolicyProviderGuard(): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.tenantId !== DEFAULT_TENANT_ID) {
    return NextResponse.json(
      { error: "This operation is only available from the provider tenant" },
      { status: 403 }
    )
  }
  return await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
}
