// src/lib/auth/ldap.ts
// L'authentification LDAP est déléguée à l'orchestrator Go

import { getDb } from "@/lib/db/sqlite"
import { decryptSecret } from "@/lib/crypto/secret"

export interface LdapUser {
  dn: string
  email: string
  name: string
  avatar: string | null
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
}

// Configuration orchestrator
import { getOrchestratorApiKey } from '@/lib/orchestrator/api-key'
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

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

    const apiKey = getOrchestratorApiKey()
    if (apiKey) {
      headers['X-API-Key'] = apiKey
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
    }
  } catch (error: any) {
    console.error("Erreur orchestrator LDAP auth:", error?.message || error)
    throw new Error("Erreur de communication avec l'orchestrator pour l'authentification LDAP")
  }
}
