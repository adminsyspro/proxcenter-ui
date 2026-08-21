export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { normalizeHexColor } from '@/lib/theme/hexColor'


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

    // #754: a value stored before the colour was validated can be missing its
    // '#'. Hand the settings form the colour the administrator meant, so saving
    // once is enough to clean the row, and drop what cannot be repaired.
    settings.primaryColor = settings.primaryColor ? (normalizeHexColor(settings.primaryColor) ?? '') : ''

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

    // #754: the primary colour reaches MUI's lighten()/darken() in the theme
    // provider, which wraps the dashboard AND the login layout, so an
    // unparseable value here takes the whole tenant down with a 500 and leaves
    // no UI to undo it. An empty string means "no override" and stays allowed;
    // anything else has to be a hex colour, and a missing '#' is added rather
    // than refused.
    if (settings.primaryColor) {
      const primaryColor = normalizeHexColor(settings.primaryColor)

      if (primaryColor === null) {
        return NextResponse.json(
          { error: 'Invalid primaryColor: expected a hex colour such as #00ECB2' },
          { status: 400 }
        )
      }

      settings.primaryColor = primaryColor
    } else {
      settings.primaryColor = ''
    }

    const tenantId = await getCurrentTenantId()
    await setSetting('branding', tenantId, settings)

    return NextResponse.json({ success: true, ...settings })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
