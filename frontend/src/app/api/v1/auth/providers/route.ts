export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"

import { isLdapEnabled } from "@/lib/auth/ldap"
import { isOidcEnabled, getOidcConfig } from "@/lib/auth/oidc"
import { getActiveTenantConnectionBySlug, providerIdFor, PROVIDER_CONNECTION_ID } from "@/lib/auth/oidcConnections"

type LoginOidc = { providerName?: string | null; showLocalLogin?: boolean | null; forceSsoRedirect?: boolean | null }

/**
 * The SSO part of the login page. `?tenant=<slug>` is the tenant login page
 * (/login/<slug>, issue #1289): with a live IdP of its own, that IdP replaces the
 * provider's. An unknown slug, or a tenant without one, answers exactly like
 * /login, so the page tells nothing about which tenants exist.
 */
async function oidcAnswer(tenantSlug: string | null) {
  if (tenantSlug) {
    const tenantConnection = await getActiveTenantConnectionBySlug(tenantSlug)
    if (tenantConnection) return ssoPageOptions(true, providerIdFor(tenantConnection.id), tenantConnection)
  }

  const oidcEnabled = await isOidcEnabled()
  const config = oidcEnabled ? await getOidcConfig() : null
  return ssoPageOptions(oidcEnabled, providerIdFor(PROVIDER_CONNECTION_ID), config)
}

// Login-page behavior. Only meaningful when OIDC is on; default to the safe
// values (local form visible, no auto-redirect) otherwise so the local form can
// never be hidden without a working SSO.
function ssoPageOptions(oidcEnabled: boolean, oidcProviderId: string, config: LoginOidc | null) {
  return {
    oidcEnabled,
    oidcProviderId,
    oidcProviderName: (oidcEnabled && config?.providerName) || "SSO",
    showLocalLogin: oidcEnabled ? (config?.showLocalLogin ?? true) : true,
    forceSsoRedirect: oidcEnabled ? (config?.forceSsoRedirect ?? false) : false,
  }
}

export async function GET(req?: Request) {
  try {
    const tenantSlug = req ? new URL(req.url).searchParams.get("tenant") : null
    const [oidc, ldapEnabled] = await Promise.all([oidcAnswer(tenantSlug), isLdapEnabled()])

    return NextResponse.json({ credentialsEnabled: true, ldapEnabled, ...oidc })
  } catch (error) {
    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: false,
      oidcEnabled: false,
      oidcProviderId: "oidc",
      oidcProviderName: 'SSO',
      showLocalLogin: true,
      forceSsoRedirect: false,
    })
  }
}
