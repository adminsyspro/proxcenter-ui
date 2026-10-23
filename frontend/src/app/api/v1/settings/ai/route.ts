export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { AI_SECRET_FIELDS, maskAiSecrets, mergeAiSecretUpdate } from '@/lib/ai/settingsSecrets'
import { AI_SETTINGS_KEY, getOwnAiSettings } from '@/lib/ai/storedSecrets'
import { withAudit } from '@/lib/audit/withAudit'

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

// Tenant-scoped on purpose (not provider-only): each tenant may run its own
// assistant, and a tenant admin configures its own row. What never crosses the
// tenant line is a key: the keys shown as set, kept on save or replayed by the
// probes are the tenant's OWN, never the provider's inherited ones (see
// lib/ai/storedSecrets.ts), and they leave the server only as a mask.

// GET /api/v1/settings/ai - Read the AI settings, keys masked
export async function GET() {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    // Non-secret fields inherit the provider's row as before; the keys do not.
    const effective = await getSetting<typeof DEFAULT_AI_SETTINGS>(AI_SETTINGS_KEY, tenantId)
    const own = await getOwnAiSettings(tenantId)
    const visible: Record<string, unknown> = { ...(effective ?? DEFAULT_AI_SETTINGS) }
    for (const field of AI_SECRET_FIELDS) visible[field] = own?.[field] ?? ''

    return NextResponse.json({ data: maskAiSecrets(visible) })
  } catch (e: any) {
    console.error('Failed to get AI settings:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/ai - Save the AI settings, keys sealed at rest
async function handlePut(request: Request) {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
    }
    const tenantId = await getCurrentTenantId()
    const own = await getOwnAiSettings(tenantId)
    await setSetting(AI_SETTINGS_KEY, tenantId, mergeAiSecretUpdate(body, own))

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save AI settings:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'ai' }, handlePut)
