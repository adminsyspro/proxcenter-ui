// src/lib/auth/oidcConnections.ts
//
// OIDC connections, one row of `oidc_config` per tenant (issue #1289). The row
// id is the tenant id: "default" is the provider's IdP, any other id is the
// IdP of that tenant. Each live connection becomes its own NextAuth provider,
// hence its own callback URL.

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { normalizeGroupGrantMapping, normalizeMappingStrategy, projectGrantsToRoleMapping } from "./groupMapping"
import type { OidcConfig } from "./oidc"
import { isCheckedTenantConnection, normalizeAllowedDomains } from "./tenantOidc"

/** Row id of the provider's own IdP, and NextAuth's historical provider id. */
export const PROVIDER_CONNECTION_ID = "default"
const PROVIDER_ID = "oidc"
const TENANT_PROVIDER_PREFIX = "oidc-"

// Longer than any slug the tenant routes accept: refused before a query.
const MAX_SLUG_LENGTH = 100

/** NextAuth provider id of a connection: its callback is /api/auth/callback/<id>. */
export function providerIdFor(connectionId: string): string {
  return connectionId === PROVIDER_CONNECTION_ID ? PROVIDER_ID : `${TENANT_PROVIDER_PREFIX}${connectionId}`
}

/** Connection behind a NextAuth provider id, null for any non-OIDC provider. */
export function connectionIdFromProvider(providerId: string | null | undefined): string | null {
  if (providerId === PROVIDER_ID) return PROVIDER_CONNECTION_ID
  if (typeof providerId !== "string" || !providerId.startsWith(TENANT_PROVIDER_PREFIX)) return null
  const id = providerId.slice(TENANT_PROVIDER_PREFIX.length)
  return id ? id : null
}

/** True for a tenant's own IdP, false for the provider's. */
export function isTenantConnection(connection: { id: string }): boolean {
  return connection.id !== PROVIDER_CONNECTION_ID
}

function decryptOrNull(value: string | null | undefined, label: string): string | null {
  if (!value) return null
  try {
    return decryptSecret(value)
  } catch (e) {
    console.error(`Error decrypting OIDC ${label}:`, e)
    return null
  }
}

/** Database row to the runtime shape, secrets decrypted. */
export function toOidcConfig(row: any): OidcConfig {
  // group_role_mapping is JSONB holding either the tenant/vDC aware entry list
  // or, on a config written before v1.5, the legacy flat { group: role } object.
  // normalizeGroupGrantMapping absorbs both, so no data migration is needed.
  const groupGrants = normalizeGroupGrantMapping(row.groupRoleMapping)

  return {
    id: row.id ?? PROVIDER_CONNECTION_ID,
    tenantId: row.tenantId ?? row.id ?? PROVIDER_CONNECTION_ID,
    enabled: row.enabled,
    providerName: row.providerName || "SSO",
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecret: decryptOrNull(row.clientSecretEnc, "client secret"),
    scopes: row.scopes || "openid profile email",
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userinfoUrl: row.userinfoUrl,
    claimEmail: row.claimEmail || "email",
    claimName: row.claimName || "name",
    claimGroups: row.claimGroups,
    autoProvision: row.autoProvision,
    defaultRole: row.defaultRole || "viewer",
    groupRoleMapping: projectGrantsToRoleMapping(groupGrants),
    groupGrants,
    groupMappingStrategy: normalizeMappingStrategy(row.groupMappingStrategy),
    showLocalLogin: row.showLocalLogin,
    forceSsoRedirect: row.forceSsoRedirect,
    requireVerifiedEmail: row.requireVerifiedEmail,
    idpVerifiesEmail: row.idpVerifiesEmail,
    allowedDomains: normalizeAllowedDomains(row.allowedDomains),
    strictUrls: row.id !== PROVIDER_CONNECTION_ID && isCheckedTenantConnection(row.tenant?.oidcSelfService === true, row.trustedEndpoints === true),
    proxyUrl: row.proxyUrl ?? null,
    proxyUsername: row.proxyUsername ?? null,
    proxyPassword: decryptOrNull(row.proxyPasswordEnc, "proxy password"),
    proxyBypass: row.proxyBypass ?? null,
  }
}

/** Full configuration of one connection, secrets decrypted. */
export async function getOidcConnection(connectionId: string): Promise<OidcConfig | null> {
  const row = await prisma.oidcConfig.findUnique({
    where: { id: connectionId },
    include: { tenant: { select: { oidcSelfService: true } } },
  })
  return row ? toOidcConfig(row) : null
}

/** Enough configuration to send anyone to the IdP. */
function isComplete(c: { enabled: boolean; issuerUrl: string; clientId: string }): boolean {
  return c.enabled === true && !!c.issuerUrl && !!c.clientId
}

/**
 * Every connection a user can sign in through right now: enabled, with an
 * issuer and a client id, and whose tenant is enabled. The provider's comes
 * first so its button keeps its place.
 */
export async function listActiveOidcConnections(): Promise<OidcConfig[]> {
  const rows = await prisma.oidcConfig.findMany({
    where: { enabled: true },
    include: { tenant: { select: { enabled: true, oidcSelfService: true } } },
  })
  const live = rows.filter((row: any) => isComplete(row) && row.tenant?.enabled !== false)
  live.sort((a: any, b: any) => Number(isTenantConnection(a)) - Number(isTenantConnection(b)))
  return live.map(toOidcConfig)
}

/**
 * Live connection of the tenant a login page slug names. Null for an unknown
 * slug, a disabled tenant, a tenant without a live connection, and always for
 * the provider tenant, whose IdP lives on /login.
 */
export async function getActiveTenantConnectionBySlug(slug: string): Promise<OidcConfig | null> {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return null
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, enabled: true } })
  if (!tenant || !tenant.enabled || tenant.id === PROVIDER_CONNECTION_ID) return null
  const connection = await getOidcConnection(tenant.id)
  return connection && isComplete(connection) ? connection : null
}

/** Connection that issued a user's OIDC identity; the provider IdP when unknown. */
export async function connectionIdOfUser(userId: string | null | undefined): Promise<string> {
  if (!userId) return PROVIDER_CONNECTION_ID
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { oidcConnectionId: true } })
  return row?.oidcConnectionId || PROVIDER_CONNECTION_ID
}

/** Login page of a connection's users: /login, or the tenant's /login/<slug>. */
export async function loginPathOfConnection(connectionId: string): Promise<string> {
  if (connectionId === PROVIDER_CONNECTION_ID) return "/login"
  const tenant = await prisma.tenant.findUnique({ where: { id: connectionId }, select: { slug: true } })
  return tenant?.slug ? `/login/${encodeURIComponent(tenant.slug)}` : "/login"
}
