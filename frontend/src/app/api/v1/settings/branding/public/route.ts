import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/sqlite'

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
    db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`)
    const row = db.prepare("SELECT value FROM settings WHERE key = 'branding'").get() as any
    const settings = row ? { ...DEFAULT_BRANDING, ...JSON.parse(row.value) } : DEFAULT_BRANDING

    // If white label is not enabled, return defaults
    if (!settings.enabled) {
      return NextResponse.json(DEFAULT_BRANDING)
    }

    return NextResponse.json({
      enabled: true,
      appName: settings.appName,
      logoUrl: settings.logoUrl,
      faviconUrl: settings.faviconUrl,
      loginLogoUrl: settings.loginLogoUrl,
      primaryColor: settings.primaryColor,
      browserTitle: settings.browserTitle,
      poweredByVisible: settings.poweredByVisible,
    })
  } catch {
    return NextResponse.json(DEFAULT_BRANDING)
  }
}
