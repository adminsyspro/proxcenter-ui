// src/lib/ai/storedSecrets.ts
//
// The stored side of lib/ai/settingsSecrets: which `settings` row the current
// tenant may use its API keys from, and the mask resolution the probe routes
// (POST /ai/test, POST /ai/models) need. Separate from settingsSecrets.ts so
// that module stays free of Prisma and the principal.
//
// A key is only ever read from the tenant's OWN row. getSetting() inherits
// the provider's row when a tenant has none of its own, which is fine for the
// chat (the provider offers its assistant to its tenants and the key never
// leaves the server) but not for anything a tenant admin steers: the OpenAI
// probe takes a base URL from the form, so resolving the mask against the
// inherited row would send the provider's key wherever a tenant admin points
// it.

import { getSettingWithSource } from "@/lib/db/settings"
import { getCurrentTenantId } from "@/lib/tenant"

import { AI_SECRET_FIELDS, AI_SECRET_MASK, openAiSecret } from "./settingsSecrets"

export const AI_SETTINGS_KEY = "ai"

type Settings = Record<string, unknown>

/** The current tenant's own AI settings row, or null when it only inherits the provider's. */
export async function getOwnAiSettings(tenantId: string): Promise<Settings | null> {
  const found = await getSettingWithSource<Settings>(AI_SETTINGS_KEY, tenantId)
  if (!found || found.tenantId !== tenantId) return null
  return found.value && typeof found.value === "object" ? found.value : null
}

/**
 * The probe body with each masked key replaced by the current tenant's stored
 * one, so "Test connection" and the model list work on a saved key the form
 * never saw. A body without any mask is returned as is, with no DB read.
 */
export async function resolveMaskedAiSecrets<T extends Settings>(body: T): Promise<T> {
  const masked = AI_SECRET_FIELDS.filter(field => body[field] === AI_SECRET_MASK)
  if (masked.length === 0) return body

  const own = await getOwnAiSettings(await getCurrentTenantId())
  const out: Settings = { ...body }
  for (const field of masked) out[field] = openAiSecret(own?.[field])
  return out as T
}
