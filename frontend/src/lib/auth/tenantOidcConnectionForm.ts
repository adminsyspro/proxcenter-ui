// src/lib/auth/tenantOidcConnectionForm.ts
//
// Read, validate and save the OIDC connection of one customer tenant
// (issue #1289). Shared by the provider's route (any tenant) and, when the
// provider opens it, the tenant's own route (its own tenant only). Every error
// message names nothing outside the tenant: no other tenant, vDC or role.

import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { normalizeGroupGrantMapping, normalizeMappingStrategy, normalizeRoleId, type GroupGrant } from "./groupMapping"
import { checkProxyUrl, environmentProxyDisplay, PROXY_REFUSED_MESSAGE, proxyFor, type OidcProxySettings } from "./oidcProxy"
import { PROVIDER_CONNECTION_ID, providerIdFor } from "./oidcConnections"
import { isCheckedTenantConnection, normalizeAllowedDomains, TENANT_DEFAULT_ROLE_ID, tenantRoleRefSelect, tenantRoleRefusal } from "./tenantOidc"
import { assertPublicHttpsUrl, OidcUrlRefused } from "./oidcUrlGuard"

export type CustomerTenant = { id: string; slug: string; name: string; oidcSelfService: boolean }

/** The tenant behind an id, null for the provider tenant or an unknown id. */
export async function findCustomerTenant(tenantId: string): Promise<CustomerTenant | null> {
  if (!tenantId || tenantId === PROVIDER_CONNECTION_ID) return null
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true, oidcSelfService: true },
  })
}

/** Origin the IdP sees: NEXTAUTH_URL when set, else the request's. */
export function appOriginOf(req: Request): string {
  const configured = process.env.NEXTAUTH_URL
  if (configured) {
    let end = configured.length
    while (end > 0 && configured[end - 1] === "/") end--
    return configured.slice(0, end)
  }
  try {
    return new URL(req.url).origin
  } catch {
    return ""
  }
}

/** Roles a tenant connection may grant, for the role pickers. */
export async function tenantAssignableRoles(tenantId: string) {
  const rows = await prisma.rbacRole.findMany({
    where: { OR: [{ tenantId: null }, { tenantId }, { audience: "tenant" }] },
    select: { ...tenantRoleRefSelect(tenantId), name: true },
    orderBy: { name: "asc" },
  })
  return rows
    .filter(role => tenantRoleRefusal(role, tenantId) === null)
    .map(role => ({ id: role.id, name: role.name, is_system: role.isSystem }))
}

type WireEntry = { group: string; tenant: string; vdc: string; role: string }

function toWireEntries(grants: readonly GroupGrant[]): WireEntry[] {
  return grants.map(g => ({ group: g.group, tenant: g.tenantId, vdc: g.vdcId || "", role: g.role }))
}

/** What the connection form reads: values, never a secret, and this tenant's pickers only. */
export async function serializeTenantConnection(tenant: CustomerTenant, appOrigin: string, opts: { includeProxy: boolean }) {
  const row = await prisma.oidcConfig.findUnique({ where: { id: tenant.id } })
  const vdcs = await prisma.vdc.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, tenantId: true, name: true, slug: true },
    orderBy: { name: "asc" },
  })

  const proxy = opts.includeProxy
    ? {
        proxy_url: row?.proxyUrl || "",
        proxy_username: row?.proxyUsername || "",
        proxy_bypass: row?.proxyBypass || "",
        hasProxyPassword: !!row?.proxyPasswordEnc,
        env_proxy: environmentProxyDisplay(),
      }
    : {}

  return {
    tenant_id: tenant.id,
    configured: !!row,
    self_service: tenant.oidcSelfService,
    trusted_endpoints: row?.trustedEndpoints ?? false,
    enabled: row?.enabled ?? false,
    provider_name: row?.providerName || "SSO",
    issuer_url: row?.issuerUrl || "",
    client_id: row?.clientId || "",
    scopes: row?.scopes || "openid profile email",
    authorization_url: row?.authorizationUrl || "",
    token_url: row?.tokenUrl || "",
    userinfo_url: row?.userinfoUrl || "",
    claim_email: row?.claimEmail || "email",
    claim_name: row?.claimName || "name",
    claim_groups: row?.claimGroups || "groups",
    auto_provision: row?.autoProvision ?? true,
    default_role: row ? normalizeRoleId(row.defaultRole) || TENANT_DEFAULT_ROLE_ID : TENANT_DEFAULT_ROLE_ID,
    show_local_login: row?.showLocalLogin ?? true,
    force_sso_redirect: row?.forceSsoRedirect ?? false,
    group_role_mapping: JSON.stringify(toWireEntries(row ? normalizeGroupGrantMapping(row.groupRoleMapping) : [])),
    group_mapping_strategy: normalizeMappingStrategy(row?.groupMappingStrategy),
    allowed_domains: normalizeAllowedDomains(row?.allowedDomains),
    hasClientSecret: !!row?.clientSecretEnc,
    ...proxy,
    tenants: [{ id: tenant.id, name: tenant.name, slug: tenant.slug }],
    vdcs,
    roles: await tenantAssignableRoles(tenant.id),
    app_origin: appOrigin,
    callback_url: `${appOrigin}/api/auth/callback/${providerIdFor(tenant.id)}`,
    login_url: `${appOrigin}/login/${encodeURIComponent(tenant.slug)}`,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

/** Mapping and default role checked against the tenant; null when valid. */
async function grantsError(tenantId: string, grants: readonly GroupGrant[], defaultRoleId: string): Promise<string | null> {
  if (grants.some(g => g.tenantId !== tenantId)) return "Group mapping rows must target this tenant"

  const vdcIds = [...new Set(grants.map(g => g.vdcId).filter((id): id is string => !!id))]
  if (vdcIds.length > 0) {
    const owned = await prisma.vdc.findMany({ where: { id: { in: vdcIds }, tenantId }, select: { id: true } })
    if (owned.length !== vdcIds.length) return "Unknown vDC in group mapping"
  }

  const roleIds = [...new Set([defaultRoleId, ...grants.map(g => normalizeRoleId(g.role))])]
  const roles = new Map(
    (
      await prisma.rbacRole.findMany({
        where: { id: { in: roleIds } },
        select: tenantRoleRefSelect(tenantId),
      })
    ).map(r => [r.id, r]),
  )
  if (tenantRoleRefusal(roles.get(defaultRoleId) ?? null, tenantId)) return "The default role cannot be granted in this tenant"
  if (grants.some(g => tenantRoleRefusal(roles.get(normalizeRoleId(g.role)) ?? null, tenantId))) {
    return "A group mapping row uses a role that cannot be granted in this tenant"
  }
  return null
}

/**
 * Every URL of a checked connection must reach a public HTTPS address, and
 * directly: the tenant runs the IdP, the server is the one that calls it, and
 * a proxy would resolve the host out of reach of the check made at sign-in.
 */
async function strictUrlsError(urls: Record<string, string>, proxy: OidcProxySettings): Promise<string | null> {
  const typed = Object.values(urls).filter(Boolean)
  if (typed.some(url => proxyFor(proxy, url))) return PROXY_REFUSED_MESSAGE
  try {
    await Promise.all(typed.map(url => assertPublicHttpsUrl(url)))
    return null
  } catch (e) {
    if (e instanceof OidcUrlRefused) return e.message
    throw e
  }
}

/**
 * Validate the form and write the tenant's connection. Returns null on success,
 * else the status and message to answer. Only the provider (`provider: true`)
 * sets the outbound proxy and opens or closes self-service: a tenant never
 * chooses where this server's requests go.
 */
export async function saveTenantConnection(
  tenant: CustomerTenant,
  body: Record<string, any>,
  opts: { provider: boolean },
): Promise<{ status: number; error: string } | null> {
  const allowProxy = opts.provider
  const selfService = opts.provider && typeof body.self_service === "boolean" ? body.self_service : tenant.oidcSelfService
  const enabled = body.enabled === true
  const issuerUrl = text(body.issuer_url)
  const clientId = text(body.client_id)
  if (enabled && !issuerUrl) return { status: 400, error: "Issuer URL is required" }
  if (enabled && !clientId) return { status: 400, error: "Client ID is required" }

  const urls = { issuerUrl, authorizationUrl: text(body.authorization_url), tokenUrl: text(body.token_url), userinfoUrl: text(body.userinfo_url) }
  if (Object.values(urls).some(url => url && !isHttpUrl(url))) return { status: 400, error: "Endpoints must be http or https URLs" }

  // The allowed domains, the trust in the IdP's addresses and the outbound
  // proxy are the provider's: a tenant admin can neither widen the domains its
  // IdP may provision nor choose where this server's requests go.
  const stored = await prisma.oidcConfig.findUnique({
    where: { id: tenant.id },
    select: { allowedDomains: true, trustedEndpoints: true, proxyUrl: true, proxyBypass: true },
  })
  // Delegating drops the trust for good: once self-service closes, the
  // addresses the tenant chose meanwhile stay checked until the provider
  // trusts them again, knowingly.
  const requestedTrust =
    opts.provider && typeof body.trusted_endpoints === "boolean" ? body.trusted_endpoints : stored?.trustedEndpoints === true
  const trustedEndpoints = !selfService && requestedTrust

  let proxy: OidcProxySettings = { proxyUrl: stored?.proxyUrl ?? null, proxyBypass: stored?.proxyBypass ?? null }
  if (allowProxy) {
    const rawProxy = text(body.proxy_url)
    let proxyUrl: string | null = null
    if (rawProxy) {
      const checked = checkProxyUrl(rawProxy)
      if (checked.error) return { status: 400, error: checked.error }
      proxyUrl = checked.url ?? null
    }
    proxy = { proxyUrl, proxyBypass: text(body.proxy_bypass) || null }
  }

  if (isCheckedTenantConnection(selfService, trustedEndpoints)) {
    const refused = await strictUrlsError(urls, proxy)
    if (refused) return { status: 400, error: refused }
  }

  const allowedDomains = opts.provider ? normalizeAllowedDomains(body.allowed_domains) : normalizeAllowedDomains(stored?.allowedDomains)
  if (selfService && allowedDomains.length === 0) {
    return { status: 400, error: "Self-service requires at least one allowed e-mail domain" }
  }

  const grants = normalizeGroupGrantMapping(body.group_role_mapping)
  const defaultRoleId = normalizeRoleId(body.default_role) || TENANT_DEFAULT_ROLE_ID
  const invalid = await grantsError(tenant.id, grants, defaultRoleId)
  if (invalid) return { status: 400, error: invalid }

  const now = new Date()
  const data: Record<string, unknown> = {
    enabled,
    providerName: text(body.provider_name) || "SSO",
    issuerUrl,
    clientId,
    scopes: text(body.scopes) || "openid profile email",
    authorizationUrl: urls.authorizationUrl || null,
    tokenUrl: urls.tokenUrl || null,
    userinfoUrl: urls.userinfoUrl || null,
    claimEmail: text(body.claim_email) || "email",
    claimName: text(body.claim_name) || "name",
    claimGroups: text(body.claim_groups) || "groups",
    autoProvision: body.auto_provision !== false,
    defaultRole: defaultRoleId,
    // Same anti-lockout rule as the provider IdP: the local form can only be
    // hidden, or skipped, while the SSO it leaves is turned on.
    showLocalLogin: enabled ? body.show_local_login !== false : true,
    forceSsoRedirect: enabled ? body.force_sso_redirect === true : false,
    groupRoleMapping: grants,
    groupMappingStrategy: normalizeMappingStrategy(body.group_mapping_strategy),
    allowedDomains,
    updatedAt: now,
  }
  if (opts.provider || selfService) data.trustedEndpoints = trustedEndpoints

  const secret = text(body.client_secret)
  if (secret) data.clientSecretEnc = encryptSecret(secret)

  const proxyUrl = proxy.proxyUrl ?? null
  if (allowProxy) {
    const proxyUsername = proxyUrl ? text(body.proxy_username) || null : null
    data.proxyUrl = proxyUrl
    data.proxyUsername = proxyUsername
    data.proxyBypass = proxy.proxyBypass ?? null
    if (!proxyUsername) data.proxyPasswordEnc = null
    else if (text(body.proxy_password)) data.proxyPasswordEnc = encryptSecret(text(body.proxy_password))
  }

  await prisma.oidcConfig.upsert({
    where: { id: tenant.id },
    update: data,
    create: { id: tenant.id, tenantId: tenant.id, createdAt: now, ...data } as any,
  })
  if (selfService !== tenant.oidcSelfService) {
    await prisma.tenant.update({ where: { id: tenant.id }, data: { oidcSelfService: selfService } })
  }

  const { audit } = await import("@/lib/audit")
  await audit({
    action: "update",
    category: "settings",
    resourceType: "oidc_config",
    resourceId: tenant.id,
    resourceName: `OIDC connection of ${tenant.name}`,
    details: {
      connection: tenant.id,
      enabled,
      issuer_url: issuerUrl || null,
      client_id: clientId || null,
      clientSecretChanged: !!secret,
      self_service: selfService,
      trusted_endpoints: trustedEndpoints,
      ...(allowProxy ? { proxy_url: proxyUrl } : {}),
    },
    status: "success",
  })
  return null
}

/** Remove the tenant's connection; its users can no longer sign in through it. */
export async function deleteTenantConnection(tenant: CustomerTenant): Promise<void> {
  await prisma.oidcConfig.deleteMany({ where: { id: tenant.id } })
  const { audit } = await import("@/lib/audit")
  await audit({
    action: "delete",
    category: "settings",
    resourceType: "oidc_config",
    resourceId: tenant.id,
    resourceName: `OIDC connection of ${tenant.name}`,
    details: { connection: tenant.id },
    status: "success",
  })
}
