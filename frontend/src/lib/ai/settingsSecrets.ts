// src/lib/ai/settingsSecrets.ts
//
// The AI settings live as one JSON blob in the `settings` table, and until now
// the OpenAI and Anthropic API keys sat in it in clear and came back in clear
// from GET /api/v1/settings/ai to anyone holding admin.settings. These helpers
// seal the keys at rest with the same AES-GCM primitive the LDAP bind password
// and the OIDC client secret use, and keep the form from ever seeing them
// again: GET answers a fixed mask plus a `<field>Set` flag, PUT keeps the
// stored key when the mask (or nothing) comes back.
//
// Backward compatible with rows written before this module: a value without
// the `enc:` prefix is a legacy plaintext key, read as-is and sealed on the
// next write. No DB access here; the route and the chat consumers own that.

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret"

export const AI_SECRET_FIELDS = ["openaiKey", "anthropicKey"] as const
export type AiSecretField = (typeof AI_SECRET_FIELDS)[number]

/** What GET hands the form in place of a stored key, and what PUT recognises as "unchanged". */
export const AI_SECRET_MASK = "••••••••"

// Marks a sealed value. encryptSecret's own `iv.tag.data` shape is not enough
// to tell a ciphertext from a key, so the prefix makes the decision explicit.
const SEALED_PREFIX = "enc:"

type Settings = Record<string, unknown>

function keySetFlag(field: AiSecretField): string {
  return `${field}Set`
}

export function isSealedAiSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SEALED_PREFIX)
}

/** Seal one key for storage. An empty key stays empty: nothing to protect. */
export function sealAiSecret(plain: string): string {
  if (!plain) return ""
  return SEALED_PREFIX + encryptSecret(plain)
}

/**
 * The usable key behind a stored value: a sealed value is decrypted, a legacy
 * plaintext value passes through, anything else is no key. A ciphertext that
 * no longer opens (APP_SECRET rotated) reads as no key rather than as a key
 * made of ciphertext, so the provider call fails on "missing key" instead of
 * sending the ciphertext to the provider.
 */
export function openAiSecret(stored: unknown): string {
  if (typeof stored !== "string" || !stored) return ""
  if (!isSealedAiSecret(stored)) return stored
  try {
    return decryptSecret(stored.slice(SEALED_PREFIX.length))
  } catch (e) {
    console.error("[ai] stored API key cannot be decrypted, treating it as unset:", (e as Error)?.message ?? e)
    return ""
  }
}

/** The settings with every key usable: for the chat routes and the probes. */
export function openAiSecrets<T extends Settings>(settings: T): T {
  const out: Settings = { ...settings }
  for (const field of AI_SECRET_FIELDS) {
    if (field in out) out[field] = openAiSecret(out[field])
  }
  return out as T
}

/**
 * The settings as GET serves them: each stored key replaced by the mask, with
 * `<field>Set` saying whether a key is there at all. The `Set` flags are what
 * the form keys its "configured" hints on, since the mask alone cannot tell a
 * stored key from a freshly typed one.
 */
export function maskAiSecrets<T extends Settings>(settings: T): T & Record<string, boolean | string> {
  const out: Settings = { ...settings }
  for (const field of AI_SECRET_FIELDS) {
    const set = typeof out[field] === "string" && (out[field] as string).length > 0
    out[field] = set ? AI_SECRET_MASK : ""
    out[keySetFlag(field)] = set
  }
  return out as T & Record<string, boolean | string>
}

/**
 * The object PUT stores: the incoming settings with every key sealed. A key
 * sent as the mask, or left out, keeps the stored one (sealed on the way if it
 * was legacy plaintext); an empty string clears it; any other string is the
 * new key. The read-only `<field>Set` flags the form echoes back are dropped,
 * they are derived on GET.
 */
export function mergeAiSecretUpdate<T extends Settings>(incoming: T, stored: Settings | null | undefined): T {
  const out: Settings = { ...incoming }
  for (const field of AI_SECRET_FIELDS) {
    delete out[keySetFlag(field)]
    const sent = incoming[field]
    if (sent === undefined || sent === AI_SECRET_MASK) {
      const kept = stored?.[field]
      out[field] = isSealedAiSecret(kept) ? kept : sealAiSecret(openAiSecret(kept))
      continue
    }
    out[field] = typeof sent === "string" ? sealAiSecret(sent) : ""
  }
  return out as T
}
