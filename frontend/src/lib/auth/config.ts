// src/lib/auth/config.ts
import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import type { OAuthConfig } from "next-auth/providers/oauth"

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { verifyPassword, hashPassword } from "./password"
import { extractGroupsFromClaim, isLdapGroupAllowed } from "./groupMapping"
import { authenticateLdap, isLdapEnabled, getLdapConfig, resolveLdapRole, syncLdapRoleAssignment } from "./ldap"
import { getOidcConfig, oidcRoleId, syncOidcRoleAssignment } from "./oidc"

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
  }
}

// Explicitly control secure cookies based on NEXTAUTH_URL protocol
// Prevents login failures when NEXTAUTH_URL=https but access is via HTTP
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false

export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: useSecureCookies ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies ? '__Secure-next-auth.callback-url' : 'next-auth.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies ? '__Host-next-auth.csrf-token' : 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: useSecureCookies,
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
        const groups = extractGroupsFromClaim((profile as any)[oidcConfig.claimGroups || 'groups'])

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
        })
      }

      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        // Don't store avatar in JWT to keep cookie size small
        // Avatar will be fetched from DB in session callback
        token.role = user.role
        token.authProvider = account?.provider === 'oidc' ? 'oidc' : user.authProvider
      }

      // Always refresh tenantId from DB (supports tenant switching without re-login)
      if (token.id) {
        try {
          const { getUserDefaultTenantId } = await import("@/lib/tenant")
          token.tenantId = await getUserDefaultTenantId(token.id as string)
        } catch {
          token.tenantId = token.tenantId || 'default'
        }
      }

      if (token.id) {
        try {
          const { needsEnrollment } = await import("@/lib/auth/enforce-2fa")
          token.mustEnroll2fa = await needsEnrollment(token.id)
        } catch {
          token.mustEnroll2fa = false
        }
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
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 jours
    // Refresh the JWT (and re-run the jwt() callback that recomputes
    // mustEnroll2fa) every 60 s of session activity. Closes the gap where
    // an admin enables the 2FA-required policy and an already-logged-in
    // session would otherwise keep its stale token until it expires.
    updateAge: 60,
  },
  secret: process.env.NEXTAUTH_SECRET || "build-time-placeholder",
}

/**
 * Returns authOptions with OIDC provider dynamically included if configured.
 * Used only in the [...nextauth] route handler.
 * All getServerSession(authOptions) calls remain unchanged (JWT validation doesn't need the provider list).
 */
export async function getAuthOptions(): Promise<NextAuthOptions> {
  const oidcConfig = await getOidcConfig()

  if (!oidcConfig || !oidcConfig.enabled || !oidcConfig.issuerUrl || !oidcConfig.clientId) {
    return authOptions
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

  return {
    ...authOptions,
    providers: [...authOptions.providers, oidcProvider],
  }
}
