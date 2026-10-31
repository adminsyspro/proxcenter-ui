import { getSetting, setSetting } from '@/lib/db/settings'

import { AI_ACTIONS_SETTINGS_KEY, normalizeAiActionsSettings, type AiActionsSettings } from './types'

// Same tenant-scoped store as the assistant's own settings (`ai`). Always
// normalised on the way in and out, so a stale or hand-edited row can never
// widen what the assistant is allowed to propose.
export async function getAiActionsSettings(tenantId: string): Promise<AiActionsSettings> {
  const stored = await getSetting<unknown>(AI_ACTIONS_SETTINGS_KEY, tenantId)
  return normalizeAiActionsSettings(stored)
}

export async function saveAiActionsSettings(tenantId: string, raw: unknown): Promise<AiActionsSettings> {
  const normalized = normalizeAiActionsSettings(raw)
  await setSetting(AI_ACTIONS_SETTINGS_KEY, tenantId, normalized)
  return normalized
}
