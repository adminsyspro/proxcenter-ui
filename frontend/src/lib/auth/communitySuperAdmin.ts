// src/lib/auth/communitySuperAdmin.ts
//
// Community edition has no RBAC role-management UI (that is Enterprise only),
// so an account created there receives no grant and can see nothing at all:
// the dashboard renders, every other page and menu entry is filtered out
// (issue #512). Community therefore grants every user full super-admin.
//
// The grant may only fire on a Community *deployment*. getServerLicense()
// fails closed to a community-looking payload with `resolved: false` whenever
// the orchestrator is unreachable, and an expired Enterprise licence also
// reports enterprise:false, so auto-granting global super-admin on either
// would be a privilege escalation (issue #633 follow-up).
//
// A resolved verdict alone is not the right test though: a genuine Community
// install runs the frontend ALONE, with no orchestrator to ask, so its verdict
// is never resolved and the grant never fired, so the #512 dead-end came back
// in v1.4.7 (issue #755). What separates the two cases is deployment shape, not
// the answer: every Enterprise deployment sets ORCHESTRATOR_URL explicitly
// (docker-compose.enterprise.yml, docker-compose.ha.yml, install-enterprise.sh)
// while the Community compose ships without it ("# No ORCHESTRATOR_URL =
// Community mode"). An unset ORCHESTRATOR_URL means there is no orchestrator
// to be unreachable, so a community verdict is the only verdict there can be.

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import type { ServerLicense } from "./requireEnterprise"

export const SUPER_ADMIN_ROLE_ID = "role_super_admin"

/**
 * True when this installation was deployed without an orchestrator, i.e. the
 * Community compose. Read at call time, never cached at module scope, so tests
 * and a runtime env change both see the current value.
 */
export function isOrchestratorConfigured(): boolean {
  return Boolean(process.env.ORCHESTRATOR_URL)
}

/**
 * True when the installation is Community and we can say so without guessing:
 * either the orchestrator positively answered "community", or there is no
 * orchestrator configured at all. An Enterprise deployment whose orchestrator
 * is merely down keeps `resolved: false` with ORCHESTRATOR_URL set and is
 * refused, as is an expired Enterprise licence (edition stays "enterprise").
 */
export function isCommunityDeployment(license: ServerLicense): boolean {
  if (license.edition !== "community") return false

  return license.resolved === true || !isOrchestratorConfigured()
}

/** Active-grant filter, mirroring the private one in lib/rbac. */
function activeGrantFilter() {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
}

/**
 * Whether the user holds any active RBAC authority at all: a role grant or a
 * direct permission grant. A user with none of either sees nothing.
 */
export async function hasAnyActiveGrant(userId: string): Promise<boolean> {
  const [role, permission] = await Promise.all([
    prisma.rbacUserRole.findFirst({
      where: { userId, ...activeGrantFilter() },
      select: { id: true },
    }),
    prisma.rbacUserPermission.findFirst({
      where: { userId, ...activeGrantFilter() },
      select: { id: true },
    }),
  ])

  return Boolean(role || permission)
}

/**
 * Give `userId` the global super-admin grant, filed on the tenant their session
 * will actually run in (`loadJwtContext` reads the isDefault membership), and
 * mirror it on the legacy users.role column. Caller decides *whether* to grant.
 */
export async function grantSuperAdmin(userId: string): Promise<void> {
  const membership = await prisma.userTenant.findFirst({
    where: { userId, isDefault: true },
    select: { tenantId: true },
  })
  const now = new Date()

  await prisma.$transaction([
    prisma.rbacUserRole.create({
      data: {
        id: nanoid(),
        userId,
        roleId: SUPER_ADMIN_ROLE_ID,
        scopeType: "global",
        scopeTarget: null,
        tenantId: membership?.tenantId ?? DEFAULT_TENANT_ID,
        grantedAt: now,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { role: "super_admin", updatedAt: now },
    }),
  ])
}

/**
 * Repair pass for accounts created while the grant was wrongly withheld
 * (issue #755): every user created through the UI between v1.4.7 and this fix
 * on a Community install has zero grants, and Community offers no way to give
 * them any, the role picker is Enterprise-gated, so the operator is stuck.
 *
 * Runs on sign-in. The cheap grant lookup comes first so an installation whose
 * users all have roles (every Enterprise one) never pays for the licence
 * probe. Idempotent: a user who already holds anything is left untouched, so a
 * deliberately scoped Enterprise account is never escalated.
 *
 * Returns true when a grant was written.
 */
export async function backfillCommunitySuperAdmin(userId: string): Promise<boolean> {
  if (!userId) return false
  if (await hasAnyActiveGrant(userId)) return false

  const { getServerLicense } = await import("./requireEnterprise")
  if (!isCommunityDeployment(await getServerLicense())) return false

  await grantSuperAdmin(userId)

  const { audit } = await import("@/lib/audit")
  await audit({
    action: "update",
    category: "users",
    resourceType: "user",
    resourceId: userId,
    userId,
    details: { superAdminGranted: true, reason: "community_backfill" },
    status: "success",
  })

  return true
}
