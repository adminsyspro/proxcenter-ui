// Shared provider-tenant + RBAC guard for the storage-policy admin routes
// (route.ts and [policyId]/route.ts). NOT a route itself: the app router
// only treats a file literally named route.ts as one, so colocating this
// here keeps both route files importing the same guard body instead of
// duplicating it (duplication would also trip the Sonar new-code gate).
import { NextResponse } from "next/server"

import { getPrincipal } from "@/lib/auth/principal"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant, DEFAULT_TENANT_ID } from "@/lib/tenant"

// requireProviderTenant() judges the caller's own tenant (the raw session
// claim, or the token's tenant) and, for a session, its membership of the
// provider tenant (#1184). The principal's tenant is checked again here so
// this sensitive surface never depends on how that helper evolves.
// `permission`: admin.settings.vdcs to change a policy, admin.settings.view
// to list them; admin.settings implies both (issue #1360).
export async function storagePolicyProviderGuard(permission: string = PERMISSIONS.ADMIN_SETTINGS_VDCS): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const result = await getPrincipal()
  if (!result.ok || result.principal?.tenantId !== DEFAULT_TENANT_ID) {
    return NextResponse.json(
      { error: "This operation is only available from the provider tenant" },
      { status: 403 }
    )
  }
  return await checkPermission(permission)
}
