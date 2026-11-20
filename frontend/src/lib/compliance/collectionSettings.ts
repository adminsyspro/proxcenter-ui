// How the compliance collection treats the Proxmox VE API, per tenant.
//
// Pure module (no database): the Policies tab imports the choices and the
// bounds, the server reads and writes the row through collectionSettingsStore.

/** Minutes a collection is reused. 0 = every screen and report collects afresh. */
export const COLLECTION_CACHE_MINUTES_CHOICES = [0, 1, 5, 15, 30] as const
export const DEFAULT_COLLECTION_CACHE_MINUTES = 5

/**
 * Guests read at the same time (three API calls each: config, firewall
 * options, firewall rules), so at most 3 x this many requests in flight.
 */
export const MIN_GUEST_CONCURRENCY = 1
export const MAX_GUEST_CONCURRENCY = 10
export const DEFAULT_GUEST_CONCURRENCY = 4

export const E_COLLECTION_SETTINGS_INVALID = 'E_COLLECTION_SETTINGS_INVALID'

export interface CollectionSettings {
  cacheMinutes: number
  guestConcurrency: number
}

export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  cacheMinutes: DEFAULT_COLLECTION_CACHE_MINUTES,
  guestConcurrency: DEFAULT_GUEST_CONCURRENCY,
}

function isCacheMinutes(v: unknown): v is number {
  return typeof v === 'number' && (COLLECTION_CACHE_MINUTES_CHOICES as readonly number[]).includes(v)
}

function isGuestConcurrency(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_GUEST_CONCURRENCY && (v as number) <= MAX_GUEST_CONCURRENCY
}

/** A stored row read leniently: any field out of bounds falls back to its default. */
export function normalizeCollectionSettings(raw: unknown): CollectionSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  return {
    cacheMinutes: isCacheMinutes(r.cacheMinutes) ? r.cacheMinutes : DEFAULT_COLLECTION_CACHE_MINUTES,
    guestConcurrency: isGuestConcurrency(r.guestConcurrency) ? r.guestConcurrency : DEFAULT_GUEST_CONCURRENCY,
  }
}

/**
 * The collection fields of a Policies payload (`compliance_cache_minutes`,
 * `compliance_guest_concurrency`), checked strictly: a value out of bounds is
 * refused, never corrected. Returns null when the payload carries neither.
 */
export function parseCollectionSettingsPatch(body: unknown): Partial<CollectionSettings> | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const patch: Partial<CollectionSettings> = {}

  if ('compliance_cache_minutes' in b) {
    if (!isCacheMinutes(b.compliance_cache_minutes)) throw new Error(E_COLLECTION_SETTINGS_INVALID)
    patch.cacheMinutes = b.compliance_cache_minutes
  }

  if ('compliance_guest_concurrency' in b) {
    if (!isGuestConcurrency(b.compliance_guest_concurrency)) throw new Error(E_COLLECTION_SETTINGS_INVALID)
    patch.guestConcurrency = b.compliance_guest_concurrency as number
  }

  return Object.keys(patch).length > 0 ? patch : null
}

/** The collection settings as the Policies payload carries them. */
export function collectionSettingsToPolicyFields(s: CollectionSettings) {
  return { compliance_cache_minutes: s.cacheMinutes, compliance_guest_concurrency: s.guestConcurrency }
}
