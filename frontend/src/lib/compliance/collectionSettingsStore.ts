// Tenant row of the compliance collection settings (settings table, no column of its own).
import { getSetting, setSetting } from '@/lib/db/settings'
import {
  DEFAULT_COLLECTION_SETTINGS,
  normalizeCollectionSettings,
  type CollectionSettings,
} from '@/lib/compliance/collectionSettings'

export const COLLECTION_SETTINGS_KEY = 'compliance.collection'

/** Never fatal: a database hiccup leaves the collection on its defaults. */
export async function getCollectionSettings(tenantId: string): Promise<CollectionSettings> {
  try {
    return normalizeCollectionSettings(await getSetting(COLLECTION_SETTINGS_KEY, tenantId))
  } catch {
    return { ...DEFAULT_COLLECTION_SETTINGS }
  }
}

export async function saveCollectionSettings(
  tenantId: string,
  patch: Partial<CollectionSettings>,
): Promise<CollectionSettings> {
  const current = normalizeCollectionSettings(await getSetting(COLLECTION_SETTINGS_KEY, tenantId))
  const next = { ...current, ...patch }

  await setSetting(COLLECTION_SETTINGS_KEY, tenantId, next)

  return next
}
