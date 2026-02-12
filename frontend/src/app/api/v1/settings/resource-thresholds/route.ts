import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

const DEFAULT_THRESHOLDS = {
  cpu: { warning: 80, critical: 90 },
  ram: { warning: 80, critical: 90 },
  storage: { warning: 80, critical: 90 },
}

// GET /api/v1/settings/resource-thresholds
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const db = getDb()

    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get('resource_thresholds') as { value: string } | undefined

    if (row?.value) {
      const saved = JSON.parse(row.value)
      return NextResponse.json({ data: { ...DEFAULT_THRESHOLDS, ...saved } })
    }

    return NextResponse.json({ data: DEFAULT_THRESHOLDS })
  } catch (e: any) {
    console.error('Failed to get resource thresholds:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/resource-thresholds
export async function PUT(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await request.json()
    const db = getDb()

    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const settings = { ...DEFAULT_THRESHOLDS, ...body }
    const value = JSON.stringify(settings)
    const now = new Date().toISOString()

    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `)
    stmt.run('resource_thresholds', value, now, value, now)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save resource thresholds:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
