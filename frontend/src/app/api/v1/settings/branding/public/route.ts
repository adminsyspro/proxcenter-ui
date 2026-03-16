import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/sqlite'
import { getCurrentTenantId } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const DEFAULT_BRANDING = {
  enabled: false,
  appName: 'ProxCenter',
  logoUrl: '',
  faviconUrl: '',
  loginLogoUrl: '',
  primaryColor: '',
  browserTitle: '',
  poweredByVisible: true,
}

export async function GET() {
  try {
    const db = await getDb()
    // Try to get tenant from session, fallback to 'default' for unauthenticated requests (login page)
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}
    const row = db.prepare("SELECT value FROM settings WHERE key = 'branding' AND tenant_id = ?").get(tenantId) as any
    const settings = row ? { ...DEFAULT_BRANDING, ...JSON.parse(row.value) } : DEFAULT_BRANDING

    // If white label is not enabled, return defaults
    if (!settings.enabled) {
      return NextResponse.json(DEFAULT_BRANDING)
    }

    // Migrate old static paths to API serving paths
    const fixUrl = (url: string) =>
      url ? url.replace(/^\/uploads\/branding\//, '/api/v1/settings/branding/uploads/') : url

    return NextResponse.json({
      enabled: true,
      appName: settings.appName,
      logoUrl: fixUrl(settings.logoUrl),
      faviconUrl: fixUrl(settings.faviconUrl),
      loginLogoUrl: fixUrl(settings.loginLogoUrl),
      primaryColor: settings.primaryColor,
      browserTitle: settings.browserTitle,
      poweredByVisible: settings.poweredByVisible,
    })
  } catch {
    return NextResponse.json(DEFAULT_BRANDING)
  }
}
