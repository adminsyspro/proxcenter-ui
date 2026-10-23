// One read for everything the NextAuth `jwt` callback needs per request.
//
// The callback runs on EVERY getServerSession, so on every guarded API call
// (checkPermission calls it first thing). Before consolidation that path cost
// up to five round trips, including two separate user.findUnique on the same
// row. This collapses the tenant lookup, both 2FA lookups and the session
// lookup into a single query, so adding the session check makes the hot path
// faster than it was rather than slower.
//
// getUserDefaultTenantId and needsEnrollment keep their own callers and their
// own behaviour; this is an additional, faster path, not a replacement.
import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { sessionRowSelect, type SessionRow } from "./sessions"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

// The tenant a session runs in: the default membership, else the oldest one,
// skipping disabled tenants. Falling straight back to DEFAULT_TENANT_ID when
// no usable row is left (the tenant was disabled or deleted, the user was
// removed from it) would put a customer user in the provider tenant
// (roadmap#79), so a user whose every tenant is disabled is refused instead.
const MEMBERSHIPS = {
  orderBy: [{ isDefault: "desc" as const }, { joinedAt: "asc" as const }],
  select: { tenantId: true, tenant: { select: { enabled: true } } },
}

type MembershipRow = { tenantId: string; tenant: { enabled: boolean } }

/** No membership at all keeps the historical provider default (super admins). */
function sessionTenant(memberships: MembershipRow[]): { tenantId: string; tenantEnabled: boolean } {
  if (memberships.length === 0) return { tenantId: DEFAULT_TENANT_ID, tenantEnabled: true }
  const usable = memberships.find(m => m.tenant.enabled)
  return usable
    ? { tenantId: usable.tenantId, tenantEnabled: true }
    : { tenantId: memberships[0].tenantId, tenantEnabled: false }
}

export interface JwtContext {
  enabled: boolean
  tenantId: string
  /** False when every tenant the user belongs to is disabled (roadmap#79). */
  tenantEnabled: boolean
  mustEnroll2fa: boolean
  session: SessionRow | null
}

export async function loadJwtContext(userId: string, sid: string | null): Promise<JwtContext> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      enabled: true,
      totpEnabled: true,
      require2faEnrollment: true,
      tenants: MEMBERSHIPS,
      // Only ask for the session when the token actually carries one.
      ...(sid ? { sessions: { where: { id: sid }, take: 1, select: sessionRowSelect } } : {}),
    },
  })

  if (!row) {
    return { enabled: false, tenantId: DEFAULT_TENANT_ID, tenantEnabled: true, mustEnroll2fa: false, session: null }
  }

  const { tenantId, tenantEnabled } = sessionTenant(row.tenants)
  const session = (sid ? ((row as any).sessions?.[0] ?? null) : null) as SessionRow | null

  return {
    enabled: row.enabled,
    tenantId,
    tenantEnabled,
    mustEnroll2fa: await resolveMustEnroll(userId, row.totpEnabled, row.require2faEnrollment),
    session,
  }
}

/**
 * Whether every tenant the user belongs to is disabled. Checked by every
 * sign-in path, so such a user is refused like a disabled account
 * (roadmap#79).
 */
export async function isSessionTenantDisabled(userId: string): Promise<boolean> {
  const rows = await prisma.userTenant.findMany({ where: { userId }, ...MEMBERSHIPS })
  return !sessionTenant(rows).tenantEnabled
}

/** Mirrors needsEnrollment / isEnrollmentRequiredFor, reusing the row already read. */
async function resolveMustEnroll(
  userId: string,
  totpEnabled: boolean,
  require2faEnrollment: boolean,
): Promise<boolean> {
  if (totpEnabled) return false
  if (require2faEnrollment) return true

  const policy = await prisma.securityPolicy.findFirst({
    where: { id: "default" },
    select: { require2faForSuperAdmin: true },
  })
  if (!policy?.require2faForSuperAdmin) return false

  const sa = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: SUPER_ADMIN_ROLE_ID,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  })
  return !!sa
}
