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

    if (oidcEnabled) {
      const config = await getOidcConfig()

      oidcProviderName = config?.providerName || 'SSO'
    }

    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled,
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
