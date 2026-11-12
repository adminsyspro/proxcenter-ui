import { prisma } from "@/lib/db/prisma"
import { PROTECTED_SSO_ROLE_IDS } from "./groupMapping"

export type OidcLinkRefusal =
  | "oidc_sub_mismatch"
  | "email_not_verified"
  // Tenant IdPs (issue #1289): the address belongs to an account the tenant IdP
  // does not own, or to a domain the connection does not accept.
  | "email_in_use"
  | "email_domain_not_allowed"

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
 * Whether the e-mail claim can be trusted to link an existing account: the IdP
 * says it is verified, or the administrator stated that this IdP only hands
 * out verified addresses and the claim is simply absent. An explicit "false"
 * is never trusted.
 */
export function isEmailVouched(claim: unknown, idpVerifiesEmail: boolean): boolean {
  if (isEmailVerified(claim)) return true

  return idpVerifiesEmail && (claim === undefined || claim === null)
}

/**
 * Decide whether an OIDC identity may be bound to a local account that was
 * matched by e-mail only (no account carries this identity's subject yet).
 * An account already bound to another subject is never re-bound. An address
 * the IdP does not vouch for is refused when the configuration requires a
 * verified e-mail, and in every case for an account holding a provider-level
 * role. Otherwise it links, and the caller records the unverified link.
 */
export async function oidcLinkRefusal(input: {
  storedSub: string | null
  emailVerified: unknown
  requireVerifiedEmail: boolean
  idpVerifiesEmail: boolean
  isProtectedAccount: () => Promise<boolean>
}): Promise<OidcLinkRefusal | null> {
  if (input.storedSub) return "oidc_sub_mismatch"
  if (isEmailVouched(input.emailVerified, input.idpVerifiesEmail)) return null
  if (input.requireVerifiedEmail || (await input.isProtectedAccount())) return "email_not_verified"

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

/**
 * Record why an OIDC identity was refused (server log + `login_failed` audit
 * row). The user only sees a generic refusal on the login page. `connection`
 * is "default" for the provider IdP, the tenant id for a tenant's own.
 */
export async function auditOidcLinkRefusal(email: string, reason: OidcLinkRefusal, connection: string): Promise<void> {
  console.warn(`[oidc] sign-in refused for "${email}" (connection ${connection}): ${reason}`)
  try {
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "login_failed",
      category: "auth",
      userEmail: email,
      details: { reason, provider: "oidc", connection },
      status: "failure",
      errorMessage: reason,
    })
  } catch (e) {
    console.error("[oidc] cannot audit the refused sign-in:", e)
  }
}

/** Record a link made although the IdP does not vouch for the address. */
export async function auditOidcUnverifiedLink(email: string, connection: string): Promise<void> {
  console.warn(`[oidc] "${email}" linked to an existing account without a verified e-mail`)
  try {
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "login",
      category: "auth",
      userEmail: email,
      details: { reason: "email_not_verified", provider: "oidc", linked: true, connection },
      status: "warning",
    })
  } catch (e) {
    console.error("[oidc] cannot audit the unverified link:", e)
  }
}
