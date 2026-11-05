// Local password of an account that signs in through OIDC or LDAP.
//
// Once an identity provider owns an account, its old local password is a
// second way in that skips the provider and its MFA. It is dropped when the
// account is converted and refused afterwards, with one exception: the
// emergency access a super admin grants on purpose (localLoginAllowed), which
// the last super admin still holding a local password keeps automatically so
// an identity provider outage never locks the whole instance out.
import { prisma } from "@/lib/db/prisma"

export type AuthProvider = "credentials" | "ldap" | "oidc"

export function isExternalProvider(provider: string | null | undefined): boolean {
  return provider === "oidc" || provider === "ldap"
}

/**
 * True when no other enabled super admin can still sign in with a local
 * password: credentials accounts, or SSO accounts with emergency access.
 */
export async function isLastLocalSuperAdmin(userId: string, now: Date = new Date()): Promise<boolean> {
  const activeGrant = { roleId: "role_super_admin", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }

  const isSuperAdmin = await prisma.rbacUserRole.findFirst({
    where: { userId, ...activeGrant },
    select: { id: true },
  })
  if (!isSuperAdmin) return false

  const other = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      enabled: true,
      password: { not: null },
      OR: [{ authProvider: "credentials" }, { localLoginAllowed: true }],
      rolesAssigned: { some: activeGrant },
    },
    select: { id: true },
  })

  return other === null
}

export type LocalPasswordDecision =
  | { data: Record<string, never>; kept: null }
  | { data: { password: null }; kept: null }
  | { data: { localLoginAllowed: true }; kept: "emergency_access" | "last_super_admin" }

/**
 * What a sign-in through OIDC or LDAP does to the account's local password:
 * nothing to do, drop it, or keep it as emergency access.
 */
export async function localPasswordOnExternalSignIn(
  user: { id: string; password: string | null; localLoginAllowed: boolean },
  now: Date = new Date()
): Promise<LocalPasswordDecision> {
  if (!user.password) return { data: {}, kept: null }
  if (user.localLoginAllowed) return { data: { localLoginAllowed: true }, kept: "emergency_access" }
  if (await isLastLocalSuperAdmin(user.id, now)) return { data: { localLoginAllowed: true }, kept: "last_super_admin" }

  return { data: { password: null }, kept: null }
}

/** Audit trail for the last super admin keeping a local password. */
export async function auditKeptForLastSuperAdmin(email: string, provider: AuthProvider): Promise<void> {
  const { audit } = await import("@/lib/audit")

  await audit({
    action: "update",
    category: "auth",
    userEmail: email,
    resourceType: "user",
    resourceName: email,
    details: { localLoginAllowed: true, reason: "last_super_admin", provider },
    status: "success",
  })
}
