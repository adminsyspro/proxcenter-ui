import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'


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
    db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`)
    const row = db.prepare("SELECT value FROM settings WHERE key = 'branding'").get() as any
    const settings = row ? { ...DEFAULT_BRANDING, ...JSON.parse(row.value) } : DEFAULT_BRANDING

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
    db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`)
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('branding', ?, datetime('now'))"
    ).run(JSON.stringify(settings))

    return NextResponse.json({ success: true, ...settings })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
