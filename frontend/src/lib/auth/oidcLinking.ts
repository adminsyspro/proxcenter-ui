import { prisma } from "@/lib/db/prisma"
import { PROTECTED_SSO_ROLE_IDS } from "./groupMapping"

export type OidcLinkRefusal = "oidc_sub_mismatch" | "email_not_verified"

/** Error code put in /login?error= when a sign-in is refused here. */
export const OIDC_LINK_REFUSED = "OidcLinkRefused"

/**
 * Whether the IdP vouches for the e-mail claim. Some providers send the
 * boolean as a string, none sends it at all by default (Entra ID).
 */
export function isEmailVerified(claim: unknown): boolean {
  return claim === true || claim === "true"
}

/**
 * Decide whether an OIDC identity may be bound to a local account that was
 * matched by e-mail only (no account carries this identity's subject yet).
 * An account already bound to another subject is never re-bound, and an
 * address the IdP does not vouch for never takes over an account holding a
 * provider-level role. Every other account links as before.
 */
export async function oidcLinkRefusal(input: {
  storedSub: string | null
  emailVerified: unknown
  isProtectedAccount: () => Promise<boolean>
}): Promise<OidcLinkRefusal | null> {
  if (input.storedSub) return "oidc_sub_mismatch"
  if (!isEmailVerified(input.emailVerified) && (await input.isProtectedAccount())) return "email_not_verified"
  return null
}

/** True when the user holds an active super admin or provider admin grant. */
export async function holdsProtectedRole(userId: string, now: Date = new Date()): Promise<boolean> {
  const grant = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: { in: [...PROTECTED_SSO_ROLE_IDS] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  })

  return grant !== null
}
