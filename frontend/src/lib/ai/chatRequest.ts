// src/lib/ai/chatRequest.ts
//
// The opening shared by the two chat routes (/api/v1/ai/chat and its
// streaming twin): who may chat, what was asked, in which language, and the
// tenant's AI settings. The gates come first and in this order: no assistant
// for an IaaS (vDC) tenant (lib/tenant/iaasGuard), connection.view, then the
// Enterprise feature, so a direct call cannot get round the hidden widget.

import { getSetting } from '@/lib/db/settings'
import { openAiSecrets } from '@/lib/ai/settingsSecrets'
import { getRequestLocale, normalizeLocale } from '@/lib/ai/locale'
import { DEFAULT_OLLAMA_MODEL } from '@/lib/ai/qualifiedModels'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

/** The tenant's AI settings, keys opened; assistant off when none are stored. */
export async function getAISettings(): Promise<any> {
  try {
    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<any>('ai', tenantId)
    // Keys are sealed at rest (lib/ai/settingsSecrets); open them for the call.
    if (stored) return openAiSecrets(stored)
  } catch (e) {
    console.error('Failed to get AI settings:', e)
  }

  return {
    enabled: false,
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: DEFAULT_OLLAMA_MODEL
  }
}

export interface ChatRequest {
  messages: any[]
  timeZone: unknown
  conversationId: unknown
  /** The UI locale: the drawer sends it, the NEXT_LOCALE cookie covers any caller that does not. */
  uiLocale: string
  lang: 'fr' | 'en'
  settings: any
}

/** The refusal of a gate, or the parsed request with its locale and settings. */
export async function openChatRequest(
  request: Request,
): Promise<{ ok: true; chat: ChatRequest } | { ok: false; response: Response }> {
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return { ok: false, response: iaasDenied }

  const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
  if (denied) return { ok: false, response: denied }

  const unlicensed = await requireFeature(Features.AI_INSIGHTS)
  if (unlicensed) return { ok: false, response: unlicensed }

  const { messages, locale, timeZone, conversationId } = await request.json()
  const uiLocale = locale ? normalizeLocale(locale) : await getRequestLocale()

  return {
    ok: true,
    chat: { messages, timeZone, conversationId, uiLocale, lang: uiLocale === 'fr' ? 'fr' : 'en', settings: await getAISettings() },
  }
}
