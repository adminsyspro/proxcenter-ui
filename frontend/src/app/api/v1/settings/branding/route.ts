export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'


const DEFAULT_BRANDING = {
  enabled: false,        // white label master switch
  appName: 'ProxCenter',
  logoUrl: '',           // empty = use default SVG logo
  faviconUrl: '',        // empty = use default favicon
  loginLogoUrl: '',      // empty = use default
  primaryColor: '',      // empty = use theme default
  footerText: '',        // empty = use default "© {year} ProxCenter"
  browserTitle: '',      // empty = use default "PROXCENTER"
  poweredByVisible: true, // show "Powered by ProxCenter" in footer
}

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const db = await getDb()
    const tenantId = await getCurrentTenantId()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'branding' AND tenant_id = ?").get(tenantId) as any
    const settings = row ? { ...DEFAULT_BRANDING, ...JSON.parse(row.value) } : DEFAULT_BRANDING

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

    const db = await getDb()
    const tenantId = await getCurrentTenantId()
    db.prepare(
      `INSERT INTO settings (key, tenant_id, value, updated_at) VALUES ('branding', ?, ?, datetime('now'))
       ON CONFLICT(key, tenant_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(tenantId, JSON.stringify(settings))

    return NextResponse.json({ success: true, ...settings })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
