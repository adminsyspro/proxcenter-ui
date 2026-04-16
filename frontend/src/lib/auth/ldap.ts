// src/lib/auth/ldap.ts
// L'authentification LDAP est déléguée à l'orchestrator Go

import { getDb } from "@/lib/db/sqlite"
import { decryptSecret } from "@/lib/crypto/secret"

export interface LdapUser {
  dn: string
  email: string
  name: string
  avatar: string | null
  groups: string[]
}

export interface LdapConfig {
  enabled: boolean
  url: string
  bindDn: string | null
  bindPassword: string | null
  baseDn: string
  userFilter: string
  emailAttribute: string
  nameAttribute: string
  tlsInsecure: boolean
  groupAttribute: string
  groupRoleMapping: Record<string, string>
  defaultRole: string
  requireGroup: boolean
  allowedGroups: string[]
}

// Configuration orchestrator
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

/**
 * Vérifie si LDAP est activé
 */
export function isLdapEnabled(): boolean {
  const db = getDb()

  const config = db
    .prepare("SELECT enabled FROM ldap_config WHERE id = 'default'")
    .get() as { enabled: number } | undefined

  return config?.enabled === 1
}

/**
 * Récupère la configuration LDAP depuis la base de données
 */
export function getLdapConfig(): LdapConfig | null {
  const db = getDb()

  const config = db
    .prepare("SELECT * FROM ldap_config WHERE id = 'default'")
    .get() as any

  if (!config) return null

  let bindPassword = null

  if (config.bind_password_enc) {
    try {
      bindPassword = decryptSecret(config.bind_password_enc)
    } catch (e) {
      console.error("Erreur déchiffrement bind password LDAP:", e)
    }
  }

  let groupRoleMapping: Record<string, string> = {}
  try {
    if (config.group_role_mapping) {
      groupRoleMapping = JSON.parse(config.group_role_mapping)
    }
  } catch {}

  return {
    enabled: config.enabled === 1,
    url: config.url,
    bindDn: config.bind_dn,
    bindPassword,
    baseDn: config.base_dn,
    userFilter: config.user_filter,
    emailAttribute: config.email_attribute,
    nameAttribute: config.name_attribute,
    tlsInsecure: config.tls_insecure === 1,
    groupAttribute: config.group_attribute || 'memberOf',
    groupRoleMapping,
    defaultRole: config.default_role || 'role_viewer',
    requireGroup: config.require_group === 1,
    allowedGroups: (() => {
      try { return JSON.parse(config.allowed_groups || '[]') }
      catch { return [] }
    })(),
  }
}

/**
 * Authentifie un utilisateur via LDAP
 * 
 * L'authentification est déléguée à l'orchestrator Go.
 * La config LDAP est envoyée dans la requête.
 */
export async function authenticateLdap(
  username: string,
  password: string
): Promise<LdapUser | null> {
  // Vérifier si LDAP est activé
  if (!isLdapEnabled()) {
    return null
  }

  // Récupérer la config LDAP depuis la DB
  const config = getLdapConfig()
  
  if (!config || !config.enabled) {
    return null
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (ORCHESTRATOR_API_KEY) {
      headers['X-API-Key'] = ORCHESTRATOR_API_KEY
    }

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/auth/ldap/authenticate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        username, 
        password,
        config: {
          url: config.url,
          bind_dn: config.bindDn,
          bind_password: config.bindPassword,
          base_dn: config.baseDn,
          user_filter: config.userFilter,
          email_attribute: config.emailAttribute,
          name_attribute: config.nameAttribute,
          tls_insecure: config.tlsInsecure,
          group_attribute: config.groupAttribute,
        }
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`Orchestrator LDAP auth failed: ${res.status} ${text}`)
      return null
    }

    const data = await res.json()

    if (!data.success || !data.user) {
      return null
    }

    return {
      dn: data.user.dn,
      email: data.user.email,
      name: data.user.name,
      avatar: data.user.avatar || null,
      groups: data.user.groups || [],
    }
  } catch (error: any) {
    console.error("Erreur orchestrator LDAP auth:", error?.message || error)
    throw new Error("Erreur de communication avec l'orchestrator pour l'authentification LDAP")
  }
}

/**
 * Résout le rôle RBAC depuis les groupes LDAP en utilisant le mapping configuré.
 * - Match exact d'abord (DN complet), puis extraction du CN
 * - Premier match gagne
 * - Fallback vers config.defaultRole
 */
export function resolveLdapRole(groups: string[], config: LdapConfig): string | null {
  if (!groups || groups.length === 0 || !config.groupRoleMapping || Object.keys(config.groupRoleMapping).length === 0) {
    // No mapping configured — return null to preserve manually assigned roles
    return null
  }

  for (const group of groups) {
    // Match exact (DN complet)
    if (config.groupRoleMapping[group]) {
      return config.groupRoleMapping[group]
    }

    // Extraction du CN pour match simplifié
    const cnMatch = group.match(/^CN=([^,]+)/i)
    if (cnMatch) {
      const cn = cnMatch[1]
      if (config.groupRoleMapping[cn]) {
        return config.groupRoleMapping[cn]
      }
    }
  }

  // No group matched — return null to preserve manually assigned roles
  return null
}
