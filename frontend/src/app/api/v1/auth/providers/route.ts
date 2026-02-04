import { NextResponse } from "next/server"

import { isLdapEnabled } from "@/lib/auth/ldap"

export async function GET() {
  try {
    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: isLdapEnabled(),
    })
  } catch (error) {
    return NextResponse.json({
      credentialsEnabled: true,
      ldapEnabled: false,
    })
  }
}
