// src/lib/auth/config.ts
import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import type { OAuthConfig } from "next-auth/providers/oauth"

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { verifyPassword, hashPassword } from "./password"
import { readGroupsClaim, isLdapGroupAllowed } from "./groupMapping"
import { authenticateLdap, isLdapEnabled, getLdapConfig, resolveLdapRole, syncLdapRoleAssignment } from "./ldap"
import { getOidcConfig, oidcRoleId, syncOidcRoleAssignment } from "./oidc"
import { loadJwtContext } from "./jwtContext"
import { createSession, evaluateSession, touchSession } from "./sessions"
import { sessionDurations } from "./durations"

export type UserRole = "super_admin" | "admin" | "operator" | "viewer"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
  role: UserRole
  authProvider: "credentials" | "ldap" | "oidc"
  tenantId: string
}

declare module "next-auth" {
  interface Session {
    user: AuthUser
  }
  interface User extends AuthUser {}
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    email: string
    name: string | null
    // avatar is NOT stored in JWT to keep cookie size small
    role: UserRole
    authProvider: "credentials" | "ldap" | "oidc"
    tenantId: string
    mustEnroll2fa?: boolean
    /**
     * Server-side session row id (sessions table). Absent only on tokens
     * issued before session hardening, or when the row insert failed at
     * sign-in — both refused on the next read-path evaluation.
     */
    sid?: string
    /** When the user authenticated, epoch ms. */
    authAt?: number
  }
}

// Cookie names and the `secure` flag both live in lib/auth/cookies.ts. The
// names are static (readers must agree with the issuer); the flag is resolved
// per request in getAuthOptions(req) so a TLS reverse proxy gets `Secure`
// without the operator having to remember to edit NEXTAUTH_URL.
import {
  sessionCookieName,
  callbackUrlCookieName,
  csrfCookieName,
  envPrefersSecureCookies,
  resolveCookieSecure,
} from './cookies'

/**
 * Best-effort request origin for a new session row.
 *
 * The jwt callback receives no request object, so this reads the ambient
 * request headers. headers() throws outside a request scope, hence the
 * try/catch: an unknown origin is a cosmetic loss, a thrown sign-in is not.
 */
async function requestOrigin(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers")
    const h = await headers()
    const fwd = h.get("x-forwarded-for")
    const ip = fwd ? fwd.split(",")[0]?.trim() : h.get("x-real-ip")
    return { ipAddress: ip || null, userAgent: h.get("user-agent") }
  } catch {
    return { ipAddress: null, userAgent: null }
  }
}

/**
 * Exact messages the `jwt` callback's READ PATH throws below (never the
 * sign-in path, which never throws). Every one is a deliberate, expected
 * refusal — a legacy cookie with no `sid`, one of `evaluateSession`'s
 * `DeadReason`s (missing/revoked/idle/absolute — see ./sessions.ts), or a
 * disabled account — not evidence of a corrupted token or a rotated
 * NEXTAUTH_SECRET. This is an exact-match Set, not a substring test, so an
 * unrelated error that merely mentions "session" cannot be swept in here.
 */
const OUR_SESSION_REFUSAL_MESSAGES = new Set<string>([
  'Session not valid: no sid on token',
  'Session not valid: missing',
  'Session not valid: revoked',
  'Session not valid: idle',
  'Session not valid: absolute',
  'Account disabled',
])

function isOurSessionRefusal(code: string, metadata: unknown): metadata is Error {
  return code === 'JWT_SESSION_ERROR' && metadata instanceof Error && OUR_SESSION_REFUSAL_MESSAGES.has(metadata.message)
}

export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: sessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: envPrefersSecureCookies(),
      },
    },
    callbackUrl: {
      name: callbackUrlCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: envPrefersSecureCookies(),
      },
    },
    csrfToken: {
      name: csrfCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: envPrefersSecureCookies(),
      },
    },
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "TOTP", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email et mot de passe requis")
        }

        const email = credentials.email.toLowerCase().trim()

        // Chercher l'utilisateur
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            password: true,
            name: true,
            avatar: true,
            role: true,
            authProvider: true,
            enabled: true,
            totpEnabled: true,
          },
        })

        // Fonction pour logger les échecs
        const logFailure = async (reason: string) => {
          const { audit } = await import("@/lib/audit")

          await audit({
            action: "login_failed",
            category: "auth",
            userEmail: email,
            details: { reason, provider: "credentials" },
            status: "failure",
            errorMessage: reason,
          })
        }

        if (!user) {
          await logFailure("User not found")
          throw new Error("Identifiants invalides")
        }

        if (!user.enabled) {
          await logFailure("Account disabled")
          throw new Error("Compte désactivé")
        }

        // Vérifier le mot de passe
        if (!user.password) {
          await logFailure("No local password")
          throw new Error("Ce compte utilise une autre méthode d'authentification")
        }

        const isValid = await verifyPassword(credentials.password, user.password)

        if (!isValid) {
          await logFailure("Incorrect password")
          throw new Error("Identifiants invalides")
        }

        if (user.totpEnabled) {
          if (!credentials.totpCode) {
            throw new Error("TOTP_REQUIRED")
          }
          const { verifyTotpOrRecovery } = await import("@/lib/auth/verify-second-factor")
          const ok = await verifyTotpOrRecovery(user.id, credentials.totpCode, null)
          if (!ok) {
            await logFailure("Invalid TOTP")
            throw new Error("Identifiants invalides")
          }
        }

        // Mettre à jour last_login_at
        const loginNow = new Date()
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: loginNow },
        })

        // Safety net: ensure user has at least one tenant membership.
        // Only super admins (cross-tenant by design) get the auto-attach
        // to the provider tenant `default`. A tenant-scoped user with
        // zero memberships has been stripped of access by an admin
        // action; re-attaching them to `default` would silently elevate
        // them to provider scope. Refuse the login instead so the
        // operator sees the issue and re-assigns the user explicitly.
        const anyMembership = await prisma.userTenant.findFirst({
          where: { userId: user.id },
          select: { userId: true },
        })

        if (!anyMembership) {
          const isSuperAdmin = await prisma.rbacUserRole.findFirst({
            where: {
              userId: user.id,
              roleId: "role_super_admin",
              OR: [{ expiresAt: null }, { expiresAt: { gt: loginNow } }],
            },
            select: { id: true },
          })
          if (!isSuperAdmin) {
            await logFailure("No tenant membership")
            throw new Error("Compte sans tenant — contactez votre administrateur")
          }
          await prisma.userTenant.upsert({
            where: { userId_tenantId: { userId: user.id, tenantId: "default" } },
            update: {},
            create: { userId: user.id, tenantId: "default", isDefault: true, joinedAt: loginNow },
          })
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar || null,
          role: user.role as UserRole,
          authProvider: "credentials",
          tenantId: "default",
        }
      },
    }),
    CredentialsProvider({
      id: "ldap",
      name: "LDAP / Active Directory",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "TOTP", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Username et mot de passe requis")
        }

        // Vérifier si LDAP est activé
        if (!(await isLdapEnabled())) {
          throw new Error("Authentification LDAP non configurée")
        }

        // Authentifier via LDAP
        const ldapUser = await authenticateLdap(
          credentials.username,
          credentials.password
        )

        if (!ldapUser) {
          throw new Error("Identifiants LDAP invalides")
        }

        // Check group restriction BEFORE creating/updating user
        const ldapConfigForRestriction = await getLdapConfig()
        if (ldapConfigForRestriction?.requireGroup && ldapConfigForRestriction.allowedGroups.length > 0) {
          if (!isLdapGroupAllowed(ldapUser.groups, ldapConfigForRestriction.allowedGroups)) {
            throw new Error("Access denied: your LDAP account is not in an authorized group")
          }
        }

        const email = ldapUser.email.toLowerCase()

        // Chercher ou créer l'utilisateur (Postgres)
        let user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, role: true, enabled: true },
        })

        const now = new Date()

        if (!user) {
          // Créer l'utilisateur LDAP
          const id = nanoid()
          await prisma.user.create({
            data: {
              id,
              email,
              name: ldapUser.name,
              avatar: ldapUser.avatar,
              role: "viewer",
              authProvider: "ldap",
              ldapDn: ldapUser.dn,
              enabled: true,
              createdAt: now,
              updatedAt: now,
              lastLoginAt: now,
            },
          })

          // Add new LDAP user to default tenant (idempotent on retry).
          await prisma.userTenant.upsert({
            where: { userId_tenantId: { userId: id, tenantId: "default" } },
            update: {},
            create: { userId: id, tenantId: "default", isDefault: true, joinedAt: now },
          })

          user = { id, email, name: ldapUser.name, role: "viewer", enabled: true }
        } else {
          if (!user.enabled) {
            throw new Error("Compte désactivé")
          }

          // Mettre à jour les infos LDAP, avatar et last_login_at
          await prisma.user.update({
            where: { id: user.id },
            data: {
              name: ldapUser.name,
              avatar: ldapUser.avatar,
              ldapDn: ldapUser.dn,
              lastLoginAt: now,
              updatedAt: now,
            },
          })

          // Safety net only — see credentials provider above for rationale.
          const hasAnyLdapTenant = await prisma.userTenant.findFirst({
            where: { userId: user.id },
            select: { userId: true },
          })

          if (!hasAnyLdapTenant) {
            const isSuperAdmin = await prisma.rbacUserRole.findFirst({
              where: {
                userId: user.id,
                roleId: "role_super_admin",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              select: { id: true },
            })
            if (!isSuperAdmin) {
              throw new Error("Compte sans tenant — contactez votre administrateur")
            }
            await prisma.userTenant.upsert({
              where: { userId_tenantId: { userId: user.id, tenantId: "default" } },
              update: {},
              create: { userId: user.id, tenantId: "default", isDefault: true, joinedAt: now },
            })
          }
        }

        // Sync RBAC role from LDAP groups (Postgres / Prisma). The assignment
        // is created with scopeType "inherit" so it follows the role's default
        // scope automatically (issue #383); the helper keys its delete/replace
        // on the ldap_ id prefix so manual assignments are never clobbered.
        const ldapConfig = await getLdapConfig()
        if (ldapConfig) {
          const resolvedRoleId = resolveLdapRole(ldapUser.groups, ldapConfig)
          await syncLdapRoleAssignment(prisma, {
            userId: user.id,
            resolvedRoleId,
            defaultRoleId: ldapConfig.defaultRole || "role_viewer",
            now,
            newId: () => `ldap_${nanoid(12)}`,
          })
        }

        const localUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { totpEnabled: true },
        })
        if (localUser?.totpEnabled) {
          if (!credentials.totpCode) {
            throw new Error("TOTP_REQUIRED")
          }
          const { verifyTotpOrRecovery } = await import("@/lib/auth/verify-second-factor")
          const ok = await verifyTotpOrRecovery(user.id, credentials.totpCode, null)
          if (!ok) {
            throw new Error("Identifiants LDAP invalides")
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: ldapUser.name || user.name,
          avatar: ldapUser.avatar || null,
          role: user.role as UserRole,
          authProvider: "ldap",
          tenantId: "default",
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Handle OIDC provider sign-in: provision or update user in SQLite
      if (account?.provider === 'oidc' && profile) {
        const oidcConfig = await getOidcConfig()

        if (!oidcConfig || !oidcConfig.enabled) return false

        const now = new Date()
        const sub = (profile as any).sub as string
        const email = ((profile as any)[oidcConfig.claimEmail] || (profile as any).email || '').toLowerCase().trim()
        const name = (profile as any)[oidcConfig.claimName] || (profile as any).name || email
        // groups + whether the IdP actually sent an array (even empty); the
        // latter decides whether the group->role re-sync is authoritative (#442).
        const { groups, groupsClaimIsArray } = readGroupsClaim(profile as any, oidcConfig.claimGroups)

        if (!email) return false

        // Look up by oidc_sub first, then by email
        let existing = await prisma.user.findFirst({
          where: { oidcSub: sub },
          select: { id: true, email: true, name: true, role: true, enabled: true, oidcSub: true },
        })

        if (!existing) {
          existing = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, role: true, enabled: true, oidcSub: true },
          })
        }

        if (existing) {
          if (!existing.enabled) return false

          // Update existing user. The legacy users.role column is left as-is
          // (mirrors LDAP); the authoritative RBAC assignment is re-synced from
          // the current groups below (issue #383).
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              name,
              oidcSub: sub,
              lastLoginAt: now,
              updatedAt: now,
              authProvider: "oidc",
            },
          })

          // Safety net only — see credentials provider above for rationale.
          const hasAnyTenant = await prisma.userTenant.findFirst({
            where: { userId: existing.id },
            select: { userId: true },
          })

          if (!hasAnyTenant) {
            const isSuperAdmin = await prisma.rbacUserRole.findFirst({
              where: {
                userId: existing.id,
                roleId: "role_super_admin",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              select: { id: true },
            })
            if (!isSuperAdmin) {
              throw new Error("Compte sans tenant — contactez votre administrateur")
            }
            await prisma.userTenant.upsert({
              where: { userId_tenantId: { userId: existing.id, tenantId: "default" } },
              update: {},
              create: { userId: existing.id, tenantId: "default", isDefault: true, joinedAt: now },
            })
          }

          user.id = existing.id
          user.email = existing.email
          user.name = name
          user.role = existing.role as UserRole
          user.authProvider = 'oidc'
        } else {
          // Auto-provision new user
          if (!oidcConfig.autoProvision) return false

          const id = nanoid()
          // Legacy users.role display column (the authoritative RBAC assignment
          // is created by syncOidcRoleAssignment below).
          const roleName = oidcRoleId(groups, oidcConfig).replace(/^role_/, '')

          await prisma.user.create({
            data: {
              id,
              email,
              name,
              role: roleName,
              authProvider: "oidc",
              oidcSub: sub,
              enabled: true,
              createdAt: now,
              updatedAt: now,
              lastLoginAt: now,
            },
          })

          // Add user to default tenant
          await prisma.userTenant.upsert({
            where: { userId_tenantId: { userId: id, tenantId: "default" } },
            update: {},
            create: { userId: id, tenantId: "default", isDefault: true, joinedAt: now },
          })

          user.id = id
          user.email = email
          user.name = name
          user.role = roleName as UserRole
          user.authProvider = 'oidc'
        }

        // Re-sync the RBAC assignment from the current IdP groups on every
        // login (new or existing), mirroring the LDAP path. scopeType "inherit"
        // follows the role's default scope; only the oidc_ row is touched, so
        // manual assignments are preserved (issue #383).
        await syncOidcRoleAssignment(prisma, {
          userId: user.id,
          groups,
          config: oidcConfig,
          now,
          newId: () => `oidc_${nanoid(12)}`,
          groupsClaimIsArray,
        })
      }

      return true
    },
    async jwt({ token, user, account }) {
      // ---- SIGN-IN PATH -------------------------------------------------
      // callbacks.jwt runs here from core/routes/callback.js:397-413, which
      // has NO try/catch around it. Anything thrown below is a 500 on login
      // for every user. This branch must therefore swallow every error.
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        // Don't store avatar in JWT to keep cookie size small
        // Avatar will be fetched from DB in session callback
        token.role = user.role
        token.authProvider = account?.provider === 'oidc' ? 'oidc' : user.authProvider

        try {
          const origin = await requestOrigin()
          token.sid = await createSession({ userId: user.id, ...origin })
          token.authAt = Date.now()
        } catch (e: any) {
          // No sid means the next read-path evaluation refuses this token, so
          // the user is asked to sign in again. That is the safe outcome; a
          // 500 here would deny everyone.
          console.error('[auth-session] could not create the session row:', e?.message ?? e)
        }

        try {
          const ctx = await loadJwtContext(user.id, null)
          token.tenantId = ctx.tenantId
          token.mustEnroll2fa = ctx.mustEnroll2fa
        } catch {
          token.tenantId = token.tenantId || 'default'
          token.mustEnroll2fa = false
        }

        return token
      }

      // ---- READ PATH ----------------------------------------------------
      // Reached from core/routes/session.js:53, which IS wrapped in a
      // try/catch that calls sessionStore.clean(). Throwing here therefore
      // clears the cookie and makes getServerSession return null, which is
      // exactly the refusal we want, on every guarded route, with no
      // call-site changes.
      if (!token.id) return token

      const sid = token.sid ?? null
      if (!sid) {
        // A token with no sid predates session hardening (or its row insert
        // failed at sign-in): no row can vouch for it, so refuse without a
        // database read. This is the intended one-off reconnection at deploy,
        // and it must hold even while the database is unreachable — the
        // fail-open below only protects sessions that were once valid.
        throw new Error('Session not valid: no sid on token')
      }

      let ctx
      try {
        ctx = await loadJwtContext(token.id, sid)
      } catch (e: any) {
        // FAIL OPEN, deliberately: a Postgres outage already breaks every
        // route (they all need the DB, including to decrypt the PVE token),
        // so refusing buys no security and only causes a reconnection storm
        // when the database comes back. Logged loudly on purpose.
        console.error('[auth-session] validity check unavailable, allowing:', e?.message ?? e)
        return token
      }

      if (!ctx.enabled) {
        throw new Error('Account disabled')
      }

      const verdict = evaluateSession(ctx.session)
      if (!verdict.alive) {
        // Cast: tsconfig has strict:false, which disables discriminated-union
        // narrowing, so `verdict.reason` does not typecheck on its own.
        const { reason } = verdict as { alive: false; reason: string }
        throw new Error(`Session not valid: ${reason}`)
      }

      token.tenantId = ctx.tenantId
      token.mustEnroll2fa = ctx.mustEnroll2fa
      if (!token.authAt && ctx.session) token.authAt = ctx.session.createdAt.getTime()

      // Throttled inside touchSession using the row we already read.
      try {
        await touchSession(sid, new Date(), ctx.session)
      } catch (e: any) {
        console.warn('[auth-session] lastSeenAt refresh failed:', e?.message ?? e)
      }

      return token
    },
    async session({ session, token }) {
      // Fetch avatar from DB instead of storing in JWT (avoids large cookies)
      let avatar: string | null = null
      try {
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { avatar: true },
        })
        avatar = user?.avatar || null
      } catch (e) {
        // Ignore DB errors for avatar fetch
      }

      session.user = {
        id: token.id as string,
        email: token.email as string,
        name: token.name as string | null,
        avatar,
        role: token.role as UserRole,
        authProvider: token.authProvider as "credentials" | "ldap" | "oidc",
        tenantId: (token.tenantId as string) || 'default',
      }

      return session
    },
  },
  events: {
    async signIn({ user }) {
      // Repair accounts created while the Community super-admin grant was
      // wrongly withheld (issue #755): Community hides the role picker, so
      // without this the operator has no way to give them any right at all.
      // No-op on every other installation, and on any user who already holds
      // a grant. Never allowed to block a login that already succeeded.
      try {
        const { backfillCommunitySuperAdmin } = await import("@/lib/auth/communitySuperAdmin")
        await backfillCommunitySuperAdmin(user.id)
      } catch (e) {
        console.error("[auth] Community super-admin backfill failed:", e)
      }

      // Audit login réussi
      const { audit } = await import("@/lib/audit")

      await audit({
        action: "login",
        category: "auth",
        userId: user.id,
        userEmail: user.email || undefined,
        details: { provider: (user as any).authProvider || "credentials" },
        status: "success",
      })
    },
    async signOut({ token }) {
      // Audit logout
      const { audit } = await import("@/lib/audit")

      await audit({
        action: "logout",
        category: "auth",
        userId: token?.id as string,
        userEmail: token?.email as string,
        status: "success",
      })
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  // Every idle timeout, absolute-cap expiry, revocation, and pre-branch
  // cookie surfaces as a JWT_SESSION_ERROR (next-auth core/routes/session.js
  // catches the jwt callback's throw, calls sessionStore.clean(), logs, and
  // returns an empty body). next-auth's default logger prints those at
  // `error` level with a full stack — indistinguishable from a genuine
  // decode failure (corrupted token, changed NEXTAUTH_SECRET), so the real
  // signal drowns in routine noise. Only OUR own refusals (matched exactly
  // above) are downgraded to one quiet info line with no stack; everything
  // else falls through untouched.
  //
  // It cannot delegate to next-auth's real default logger: `next-auth/utils
  // /logger` is not a published subpath (its package.json `exports` map
  // omits it; `require("next-auth/utils/logger")` throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED). An earlier version of this reproduced
  // that default's `formatError` inline (Error -> {message, stack, name}),
  // but that reformatting only special-cased a bare Error: for the several
  // codes next-auth reports with an ENVELOPE object — OAUTH_CALLBACK_ERROR,
  // OAUTH_CALLBACK_HANDLER_ERROR, OAUTH_PARSE_PROFILE_ERROR,
  // SIGNIN_OAUTH_ERROR, SIGNIN_EMAIL_ERROR — it discarded every sibling key
  // (providerId, error_description, the raw OAuthProfile, ...) and kept only
  // the nested `.error`. That is exactly the OIDC diagnostic detail this app
  // needs when SSO breaks, so instead of rebuilding next-auth's formatting,
  // log the metadata exactly as received: `console.error` already renders a
  // bare Error with its message and stack, and renders an envelope object
  // with every one of its fields, so nothing can be dropped because nothing
  // is reconstructed. The cosmetic difference from next-auth's own default
  // shape is an acceptable trade for never losing a diagnostic field.
  logger: {
    error(code, metadata) {
      if (isOurSessionRefusal(code, metadata)) {
        console.info('[auth-session] session refused, cookie cleared:', metadata.message)
        return
      }

      console.error(`[next-auth][error][${code}]`, metadata)
    },
  },
  session: {
    strategy: "jwt",
    // Derived from SESSION_ABSOLUTE_TIMEOUT (default 7 days) so the cookie
    // cannot outlive the session. This is only the second barrier: the row in
    // `sessions` is what actually decides, since a JWT's exp is frozen at
    // encoding time. Evaluated once at module load, which is correct: the
    // environment is fixed when the process starts.
    //
    // updateAge is intentionally absent: next-auth only reads it in the
    // database branch (core/routes/session.js:109, inside the else), so with
    // strategy "jwt" it did nothing. lastSeenAt throttling is ours.
    maxAge: Math.ceil(sessionDurations().absoluteMs / 1000),
  },
  secret: process.env.NEXTAUTH_SECRET || "build-time-placeholder",
}

/**
 * Returns authOptions with OIDC included when configured, and with the cookie
 * `secure` flag resolved against THIS request's transport.
 *
 * `req` is optional: getServerSession(authOptions) callers only read the JWT
 * and never issue a cookie, so they do not need it. The NextAuth route handler
 * does issue cookies, and passes it.
 */
export async function getAuthOptions(req?: Request): Promise<NextAuthOptions> {
  const secure = resolveCookieSecure(req?.headers)

  const withSecure = (opts: NextAuthOptions): NextAuthOptions => ({
    ...opts,
    cookies: {
      sessionToken: {
        name: sessionCookieName(),
        options: { ...opts.cookies!.sessionToken!.options, secure },
      },
      callbackUrl: {
        name: callbackUrlCookieName(),
        options: { ...opts.cookies!.callbackUrl!.options, secure },
      },
      csrfToken: {
        name: csrfCookieName(),
        options: { ...opts.cookies!.csrfToken!.options, secure },
      },
    },
  })

  const oidcConfig = await getOidcConfig()

  if (!oidcConfig || !oidcConfig.enabled || !oidcConfig.issuerUrl || !oidcConfig.clientId) {
    return withSecure(authOptions)
  }

  const oidcProvider: OAuthConfig<any> = {
    id: 'oidc',
    name: oidcConfig.providerName || 'SSO',
    type: 'oauth',
    // When manual endpoint overrides are used we skip .well-known discovery,
    // so openid-client has no canonical issuer to validate the id_token `iss`
    // claim against and rejects every callback with `expected undefined`.
    // Passing `issuer` here gives it the value to compare against.
    issuer: oidcConfig.authorizationUrl ? oidcConfig.issuerUrl : undefined,
    wellKnown: oidcConfig.authorizationUrl ? undefined : `${oidcConfig.issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`,
    authorization: oidcConfig.authorizationUrl ? {
      url: oidcConfig.authorizationUrl,
      params: { scope: oidcConfig.scopes },
    } : { params: { scope: oidcConfig.scopes } },
    token: oidcConfig.tokenUrl || undefined,
    userinfo: oidcConfig.userinfoUrl || undefined,
    clientId: oidcConfig.clientId,
    clientSecret: oidcConfig.clientSecret || '',
    idToken: true,
    checks: ['state'],
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      return {
        id: profile.sub,
        email: profile[oidcConfig.claimEmail] || profile.email,
        name: profile[oidcConfig.claimName] || profile.name,
        avatar: profile.picture || null,
        role: 'viewer' as UserRole,
        authProvider: 'oidc' as const,
        tenantId: 'default',
      }
    },
  }

  return withSecure({
    ...authOptions,
    providers: [...authOptions.providers, oidcProvider],
  })
}
