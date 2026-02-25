import { NextResponse } from "next/server"

import { isLdapEnabled } from "@/lib/auth/ldap"
import { isOidcEnabled, getOidcConfig } from "@/lib/auth/oidc"

export async function GET() {
  try {
    const oidcEnabled = isOidcEnabled()
    let oidcProviderName = 'SSO'

    if (oidcEnabled) {
      const config = getOidcConfig()
      oidcProviderName = config?.providerName || 'SSO'
    }

    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: isLdapEnabled(),
      oidcEnabled,
      oidcProviderName,
    })
  } catch (error) {
    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: false,
      oidcEnabled: false,
      oidcProviderName: 'SSO',
    })
  }
}
