export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'


const DEFAULT_BRANDING = {
  enabled: false,
  appName: 'ProxCenter',
  logoUrl: '',
  faviconUrl: '',
  loginLogoUrl: '',
  primaryColor: '',
  footerText: '',
  browserTitle: '',
  poweredByVisible: true,
  loginTagline: '',
  loginHighlights: [] as Array<{ icon: string; text: string }>,
  docsUrl: '',
  supportUrl: '',
  changelogUrl: '',
  hideVersion: false,
}

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<Partial<typeof DEFAULT_BRANDING>>('branding', tenantId)
    const settings = { ...DEFAULT_BRANDING, ...(stored ?? {}) }

    // Migrate old static paths to API serving paths
    const fixUrl = (url: string) =>
      url ? url.replace(/^\/uploads\/branding\//, '/api/v1/settings/branding/uploads/') : url

    settings.logoUrl = fixUrl(settings.logoUrl)
    settings.faviconUrl = fixUrl(settings.faviconUrl)
    settings.loginLogoUrl = fixUrl(settings.loginLogoUrl)

    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json()
    const settings = { ...DEFAULT_BRANDING, ...body }

    const tenantId = await getCurrentTenantId()

    await setSetting('branding', tenantId, settings)

    return NextResponse.json({ success: true, ...settings })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
