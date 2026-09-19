import { NextResponse } from 'next/server'
import { getSettingWithSource } from '@/lib/db/settings'
import { getCurrentTenantId } from '@/lib/tenant'
import { scopedBrandingUrl } from '@/lib/branding/urls'
import { normalizeHexColor } from '@/lib/theme/hexColor'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }

const DEFAULT_BRANDING = {
  enabled: false,
  appName: 'ProxCenter',
  logoUrl: '',
  faviconUrl: '',
  loginLogoUrl: '',
  primaryColor: '',
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
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}
    const resolved = await getSettingWithSource<any>('branding', tenantId)
    const settings = { ...DEFAULT_BRANDING, ...(resolved?.value ?? {}) }

    if (!settings.enabled) {
      return NextResponse.json(DEFAULT_BRANDING, { headers: HEADERS })
    }

    const fixUrl = (url: string) =>
      scopedBrandingUrl(url, resolved?.tenantId ?? tenantId, tenantId)

    const sanitizeHighlights = (raw: unknown): Array<{ icon: string; text: string }> => {
      if (!Array.isArray(raw)) return []
      return raw
        .filter((h): h is { icon: string; text: string } =>
          h && typeof h === 'object' && typeof (h as any).icon === 'string' && typeof (h as any).text === 'string'
        )
        .slice(0, 3)
    }

    return NextResponse.json({
      enabled: true,
      appName: settings.appName,
      logoUrl: fixUrl(settings.logoUrl),
      faviconUrl: fixUrl(settings.faviconUrl),
      loginLogoUrl: fixUrl(settings.loginLogoUrl),
      // #754: this is where the branding colour enters the browser and, from
      // there, MUI's palette. A value stored before the colour was validated is
      // repaired when it can be ('00ECB2' -> '#00ECB2') and dropped otherwise,
      // so an instance already stuck on the 500 page comes back on its own.
      primaryColor: settings.primaryColor ? (normalizeHexColor(settings.primaryColor) ?? '') : '',
      browserTitle: settings.browserTitle,
      poweredByVisible: settings.poweredByVisible,
      showGithubStars: settings.showGithubStars,
      showWhatsNew: settings.showWhatsNew,
      showAbout: settings.showAbout,
      showSubscription: settings.showSubscription,
      loginTagline: typeof settings.loginTagline === 'string' ? settings.loginTagline : '',
      loginHighlights: sanitizeHighlights(settings.loginHighlights),
      docsUrl: typeof settings.docsUrl === 'string' ? settings.docsUrl : '',
      supportUrl: typeof settings.supportUrl === 'string' ? settings.supportUrl : '',
      changelogUrl: typeof settings.changelogUrl === 'string' ? settings.changelogUrl : '',
      hideVersion: !!settings.hideVersion,
    }, { headers: HEADERS })
  } catch {
    return NextResponse.json(DEFAULT_BRANDING, { headers: HEADERS })
  }
}
