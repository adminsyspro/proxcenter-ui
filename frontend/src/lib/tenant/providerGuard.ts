// src/lib/tenant/providerGuard.ts
//
// Guard of the routes that read or write PLATFORM-WIDE configuration: the
// singleton OIDC / LDAP rows, the control-plane HA config, the orchestrator's
// change-tracking settings, and anything else that is not keyed by tenant.
//
// checkPermission(ADMIN_SETTINGS) alone is not enough for them: role_tenant_admin
// carries admin.settings (prisma/roleCatalogue.ts) and its `inherit` assignment
// resolves to a global scope, so a customer tenant's admin holds the permission
// just as a provider admin does. The permission says WHAT the caller may touch
// inside their tenant; only the tenant says WHERE they stand. Both are needed.
//
// Check order is cheapest-first and fails closed before any RBAC work, as in
// lib/broadcast/guard.ts: the tenant gate reads the principal and at most two
// membership rows, checkPermission() loads the full grant set.
//
// Lives in its own module (not lib/tenant/index.ts) because lib/rbac imports
// lib/tenant: importing checkPermission from index.ts would close a cycle.

import { requireProviderTenant } from "./index"
import { checkPermission } from "@/lib/rbac"

/**
 * Strict provider tenant (see requireProviderTenant) AND `permission`.
 * Returns the 401/403 Response to hand back, or null to proceed.
 */
export async function requireProviderAdmin(permission: string): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  return checkPermission(permission)
}
