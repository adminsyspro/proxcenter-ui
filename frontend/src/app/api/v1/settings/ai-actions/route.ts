export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getAiActionsSettings, saveAiActionsSettings } from '@/lib/ai/actions/settings'
import { withAudit } from '@/lib/audit/withAudit'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

// Approved actions are an add-on of the assistant: both features are required,
// and the API refuses them too so a direct call cannot get round the UI.
async function guard() {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  const noAssistant = await requireFeature(Features.AI_INSIGHTS)
  if (noAssistant) return noAssistant
  return requireFeature(Features.AI_ACTIONS)
}

// GET /api/v1/settings/ai-actions - Read the tenant's approved-actions settings
export async function GET() {
  try {
    const denied = await guard()
    if (denied) return denied

    return NextResponse.json({ data: await getAiActionsSettings(await getCurrentTenantId()) })
  } catch (e: any) {
    console.error('Failed to get AI actions settings:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/ai-actions - Save them, normalised
async function handlePut(request: Request) {
  try {
    const denied = await guard()
    if (denied) return denied

    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
    }
    const saved = await saveAiActionsSettings(await getCurrentTenantId(), body)

    return NextResponse.json({ success: true, data: saved })
  } catch (e: any) {
    console.error('Failed to save AI actions settings:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'ai_actions' }, handlePut)
