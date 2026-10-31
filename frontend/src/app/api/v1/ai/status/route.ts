export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { requireFeature } from '@/lib/auth/requireEnterprise'
import { getSetting } from '@/lib/db/settings'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'

const MODEL_FIELDS: Record<string, string> = { ollama: 'ollamaModel', openai: 'openaiModel', anthropic: 'anthropicModel' }

/**
 * GET /api/v1/ai/status
 *
 * Whether the assistant is on, and which model answers, for every user who
 * may chat with it (#459). The widget used to read `/api/v1/settings/ai`,
 * which asks for `admin.settings`: a user without it never saw the assistant,
 * although the chat itself only needs `connection.view` and every tool is
 * scoped to what that user may see. Only the switch and the model's name
 * leave here: no URL, no key.
 */
export async function GET() {
  try {
    // The chat's own gates, in the same order.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const unlicensed = await requireFeature(Features.AI_INSIGHTS)

    if (unlicensed) return unlicensed

    const settings = await getSetting<Record<string, unknown>>('ai', await getCurrentTenantId())
    const provider = typeof settings?.provider === 'string' ? settings.provider : 'ollama'
    const modelField = MODEL_FIELDS[provider] ?? 'ollamaModel'
    const model = typeof settings?.[modelField] === 'string' ? (settings[modelField] as string) : null

    return NextResponse.json({ data: { enabled: settings?.enabled === true, provider, model } })
  } catch (e: any) {
    console.error('Failed to read the AI status:', e)

    return NextResponse.json({ error: 'Failed to read the AI status' }, { status: 500 })
  }
}
