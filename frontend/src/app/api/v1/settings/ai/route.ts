export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'mistral:7b',
  openaiKey: '',
  openaiModel: 'gpt-4.1-nano',
  anthropicKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
}

// GET /api/v1/settings/ai - Récupérer les paramètres IA
export async function GET() {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<typeof DEFAULT_AI_SETTINGS>('ai', tenantId)

    return NextResponse.json({ data: stored ?? DEFAULT_AI_SETTINGS })
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
    const tenantId = await getCurrentTenantId()

    await setSetting('ai', tenantId, body)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save AI settings:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
