// src/lib/auth/config.ts
import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import type { OAuthConfig } from "next-auth/providers/oauth"

import { nanoid } from "nanoid"

import { getDb } from "@/lib/db/sqlite"
import { verifyPassword, hashPassword } from "./password"
import { authenticateLdap, isLdapEnabled } from "./ldap"
import { getOidcConfig, resolveOidcRole } from "./oidc"

export type UserRole = "super_admin" | "admin" | "operator" | "viewer"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
  role: UserRole
  authProvider: "credentials" | "ldap" | "oidc"
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
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email et mot de passe requis")
        }

        const db = getDb()
        const email = credentials.email.toLowerCase().trim()

        // Chercher l'utilisateur
        const user = db
          .prepare(
            "SELECT id, email, password, name, avatar, role, auth_provider, enabled FROM users WHERE email = ?"
          )
          .get(email) as any

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
          await logFailure("Utilisateur non trouvé")
          throw new Error("Identifiants invalides")
        }

        if (!user.enabled) {
          await logFailure("Compte désactivé")
          throw new Error("Compte désactivé")
        }

        // Vérifier le mot de passe
        if (!user.password) {
          await logFailure("Pas de mot de passe local")
          throw new Error("Ce compte utilise une autre méthode d'authentification")
        }

        const isValid = await verifyPassword(credentials.password, user.password)
        
        if (!isValid) {
          await logFailure("Mot de passe incorrect")
          throw new Error("Identifiants invalides")
        }

        // Mettre à jour last_login_at
        db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          user.id
        )
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar || null,
          role: user.role as UserRole,
          authProvider: "credentials",
        }
      },
    }),
    CredentialsProvider({
      id: "ldap",
      name: "LDAP / Active Directory",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Username et mot de passe requis")
        }

        // Vérifier si LDAP est activé
        if (!isLdapEnabled()) {
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

        const db = getDb()
        const email = ldapUser.email.toLowerCase()

        // Chercher ou créer l'utilisateur
        let user = db
          .prepare("SELECT id, email, name, role, enabled FROM users WHERE email = ?")
          .get(email) as any

        const now = new Date().toISOString()

        if (!user) {
          // Créer l'utilisateur LDAP
          const id = nanoid()

          db.prepare(
            `INSERT INTO users (id, email, name, avatar, role, auth_provider, ldap_dn, enabled, created_at, updated_at, last_login_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
          ).run(id, email, ldapUser.name, ldapUser.avatar, "viewer", "ldap", ldapUser.dn, now, now, now)

          user = { id, email, name: ldapUser.name, role: "viewer", enabled: 1 }
        } else {
          if (!user.enabled) {
            throw new Error("Compte désactivé")
          }

          // Mettre à jour les infos LDAP, avatar et last_login_at
          db.prepare(
            "UPDATE users SET name = ?, avatar = ?, ldap_dn = ?, last_login_at = ?, updated_at = ? WHERE id = ?"
          ).run(ldapUser.name, ldapUser.avatar, ldapUser.dn, now, now, user.id)
        }

        return {
          id: user.id,
          email: user.email,
          name: ldapUser.name || user.name,
          avatar: ldapUser.avatar || null,
          role: user.role as UserRole,
          authProvider: "ldap",
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Handle OIDC provider sign-in: provision or update user in SQLite
      if (account?.provider === 'oidc' && profile) {
        const oidcConfig = getOidcConfig()

        if (!oidcConfig || !oidcConfig.enabled) return false

        const db = getDb()
        const now = new Date().toISOString()
        const sub = (profile as any).sub as string
        const email = ((profile as any)[oidcConfig.claimEmail] || (profile as any).email || '').toLowerCase().trim()
        const name = (profile as any)[oidcConfig.claimName] || (profile as any).name || email
        const groups: string[] = (profile as any)[oidcConfig.claimGroups || 'groups'] || []

        if (!email) return false

        // Look up by oidc_sub first, then by email
        let existing = db
          .prepare("SELECT id, email, name, role, enabled, oidc_sub FROM users WHERE oidc_sub = ?")
          .get(sub) as any

        if (!existing) {
          existing = db
            .prepare("SELECT id, email, name, role, enabled, oidc_sub FROM users WHERE email = ?")
            .get(email) as any
        }

        if (existing) {
          if (!existing.enabled) return false

          // Update existing user
          db.prepare(
            "UPDATE users SET name = ?, oidc_sub = ?, last_login_at = ?, updated_at = ?, auth_provider = 'oidc' WHERE id = ?"
          ).run(name, sub, now, now, existing.id)

          user.id = existing.id
          user.email = existing.email
          user.name = name
          user.role = existing.role as UserRole
          user.authProvider = 'oidc'
        } else {
          // Auto-provision new user
          if (!oidcConfig.autoProvision) return false

          const id = nanoid()
          const role = resolveOidcRole(groups, oidcConfig)

          db.prepare(
            `INSERT INTO users (id, email, name, role, auth_provider, oidc_sub, enabled, created_at, updated_at, last_login_at)
             VALUES (?, ?, ?, ?, 'oidc', ?, 1, ?, ?, ?)`
          ).run(id, email, name, role, sub, now, now, now)

          user.id = id
          user.email = email
          user.name = name
          user.role = role as UserRole
          user.authProvider = 'oidc'
        }
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

      return token
    },
    async session({ session, token }) {
      // Fetch avatar from DB instead of storing in JWT (avoids large cookies)
      let avatar: string | null = null
      try {
        const db = getDb()
        const user = db.prepare("SELECT avatar FROM users WHERE id = ?").get(token.id) as any
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
  },
  secret: process.env.NEXTAUTH_SECRET || "your-secret-key-change-in-production",
}

/**
 * Returns authOptions with OIDC provider dynamically included if configured.
 * Used only in the [...nextauth] route handler.
 * All getServerSession(authOptions) calls remain unchanged (JWT validation doesn't need the provider list).
 */
export function getAuthOptions(): NextAuthOptions {
  const oidcConfig = getOidcConfig()

  if (!oidcConfig || !oidcConfig.enabled || !oidcConfig.issuerUrl || !oidcConfig.clientId) {
    return authOptions
  }

  const oidcProvider: OAuthConfig<any> = {
    id: 'oidc',
    name: oidcConfig.providerName || 'SSO',
    type: 'oauth',
    wellKnown: oidcConfig.authorizationUrl ? undefined : `${oidcConfig.issuerUrl}/.well-known/openid-configuration`,
    authorization: oidcConfig.authorizationUrl ? {
      url: oidcConfig.authorizationUrl,
      params: { scope: oidcConfig.scopes },
    } : { params: { scope: oidcConfig.scopes } },
    token: oidcConfig.tokenUrl || undefined,
    userinfo: oidcConfig.userinfoUrl || undefined,
    clientId: oidcConfig.clientId,
    clientSecret: oidcConfig.clientSecret || '',
    idToken: true,
    checks: ['pkce', 'state'],
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      return {
        id: profile.sub,
        email: profile[oidcConfig.claimEmail] || profile.email,
        name: profile[oidcConfig.claimName] || profile.name,
        avatar: profile.picture || null,
        role: 'viewer' as UserRole,
        authProvider: 'oidc' as const,
      }
    },
  }

  return {
    ...authOptions,
    providers: [...authOptions.providers, oidcProvider],
  }
}
