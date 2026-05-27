export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"

import { isLdapEnabled } from "@/lib/auth/ldap"
import { isOidcEnabled, getOidcConfig } from "@/lib/auth/oidc"

export async function GET() {
  try {
    const [oidcEnabled, ldapEnabled] = await Promise.all([
      isOidcEnabled(),
      isLdapEnabled(),
    ])
    let oidcProviderName = 'SSO'
    // Login-page behavior. Only meaningful when OIDC is on; default to the
    // safe values (local form visible, no auto-redirect) otherwise so the
    // local form can never be hidden without a working SSO.
    let showLocalLogin = true
    let forceSsoRedirect = false

    if (oidcEnabled) {
      const config = await getOidcConfig()
      oidcProviderName = config?.providerName || 'SSO'
      showLocalLogin = config?.showLocalLogin ?? true
      forceSsoRedirect = config?.forceSsoRedirect ?? false
    }

    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled,
      oidcEnabled,
      oidcProviderName,
      showLocalLogin,
      forceSsoRedirect,
    })
  } catch (error) {
    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: false,
      oidcEnabled: false,
      oidcProviderName: 'SSO',
      showLocalLogin: true,
      forceSsoRedirect: false,
    })
  }
}
