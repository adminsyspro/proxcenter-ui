export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

// GET /api/v1/settings/ai - Récupérer les paramètres IA
export async function GET() {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const db = getDb()
    const tenantId = await getCurrentTenantId()

    const row = db.prepare('SELECT value FROM settings WHERE key = ? AND tenant_id = ?').get('ai', tenantId) as { value: string } | undefined

    if (row?.value) {
      return NextResponse.json({ data: JSON.parse(row.value) })
    }

    // Valeurs par défaut
    return NextResponse.json({
      data: {
        enabled: false,
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'mistral:7b',
        openaiKey: '',
        openaiModel: 'gpt-4.1-nano',
        anthropicKey: '',
        anthropicModel: 'claude-haiku-4-5-20251001'
      }
    })
  } catch (e: any) {
    console.error('Failed to get AI settings:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/ai - Sauvegarder les paramètres IA
export async function PUT(request: Request) {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await request.json()
    const db = getDb()
    const tenantId = await getCurrentTenantId()

    const value = JSON.stringify(body)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO settings (key, tenant_id, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key, tenant_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('ai', tenantId, value, now)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save AI settings:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
