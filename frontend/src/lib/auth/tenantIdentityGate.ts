// src/lib/auth/tenantIdentityGate.ts
//
// Gate of the tenant-side identity routes (issue #1289, lot 2). A tenant admin
// reaches its OWN tenant's OIDC connection, never another one (the tenant comes
// from the session, not from the URL), and only when:
//  - it holds admin.identity (role_tenant_admin does);
//  - the provider opened self-service for that tenant.
// The provider tenant has no such page: its IdP is set in OIDC / SSO.

import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { findCustomerTenant, type CustomerTenant } from "./tenantOidcConnectionForm"

export async function resolveTenantIdentity(): Promise<{ response?: Response; tenant?: CustomerTenant }> {
  const denied = await checkPermission(PERMISSIONS.ADMIN_IDENTITY)
  if (denied) return { response: denied }

  let tenantId: string
  try {
    tenantId = await getCurrentTenantId()
  } catch {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const tenant = await findCustomerTenant(tenantId)
  if (!tenant) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (!tenant.oidcSelfService) {
    return { response: NextResponse.json({ error: "The provider manages this tenant's identity provider" }, { status: 403 }) }
  }
  return { tenant }
}
