import { NextResponse } from 'next/server'
import { getSetting } from '@/lib/db/settings'
import { getCurrentTenantId } from '@/lib/tenant'
import { normalizeHexColor } from '@/lib/theme/hexColor'

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
    const stored = await getSetting<any>('branding', tenantId)
    const settings = { ...DEFAULT_BRANDING, ...(stored ?? {}) }

    if (!settings.enabled) {
      return NextResponse.json(DEFAULT_BRANDING)
    }

    const fixUrl = (url: string) =>
      url ? url.replace(/^\/uploads\/branding\//, '/api/v1/settings/branding/uploads/') : url

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
    })
  } catch {
    return NextResponse.json(DEFAULT_BRANDING)
  }
}
