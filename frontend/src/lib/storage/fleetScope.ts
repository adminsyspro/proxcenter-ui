import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { isUserSuperAdmin } from "@/lib/rbac"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

/**
 * Whether the caller may read storage across every tenant, which backs the
 * tenant selector of /storage/overview (issue #609).
 *
 * The session tenant is read RAW, on purpose. getCurrentTenantId()
 * (lib/tenant/index.ts:64-85) silently falls back to DEFAULT_TENANT_ID when the
 * tenant is unknown, disabled, or the user is not a member, so it would PROMOTE
 * a tenant admin with a stale JWT into the provider scope. requireProviderTenant()
 * is built on that helper and is unusable here for the same reason.
 *
 * Super admin is required on top of the provider tenant, because role_super_admin
 * is the grant that already governs seeing every tenant elsewhere in the product.
 */
export async function canReadFleetStorage(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; tenantId?: string } | undefined

  if (!user?.id) return false
  if (user.tenantId !== DEFAULT_TENANT_ID) return false

  return isUserSuperAdmin(user.id)
}
