import { describe, expect, it } from 'vitest'

import {
  collectionSettingsToPolicyFields,
  DEFAULT_COLLECTION_SETTINGS,
  E_COLLECTION_SETTINGS_INVALID,
  normalizeCollectionSettings,
  parseCollectionSettingsPatch,
} from './collectionSettings'

describe('normalizeCollectionSettings', () => {
  it('falls back to 5 minutes and 4 guests when nothing is stored', () => {
    expect(normalizeCollectionSettings(null)).toEqual({ cacheMinutes: 5, guestConcurrency: 4 })
    expect(DEFAULT_COLLECTION_SETTINGS).toEqual({ cacheMinutes: 5, guestConcurrency: 4 })
  })

  it('keeps stored values within bounds', () => {
    expect(normalizeCollectionSettings({ cacheMinutes: 0, guestConcurrency: 10 })).toEqual({ cacheMinutes: 0, guestConcurrency: 10 })
  })

  it('replaces each field out of bounds by its default, independently', () => {
    expect(normalizeCollectionSettings({ cacheMinutes: 7, guestConcurrency: 2 })).toEqual({ cacheMinutes: 5, guestConcurrency: 2 })
    expect(normalizeCollectionSettings({ cacheMinutes: 30, guestConcurrency: 0 })).toEqual({ cacheMinutes: 30, guestConcurrency: 4 })
    expect(normalizeCollectionSettings({ cacheMinutes: '5', guestConcurrency: 2.5 })).toEqual({ cacheMinutes: 5, guestConcurrency: 4 })
  })
})

describe('parseCollectionSettingsPatch', () => {
  it('returns null when the payload carries no collection field', () => {
    expect(parseCollectionSettingsPatch({ audit_retention_days: 45 })).toBeNull()
    expect(parseCollectionSettingsPatch(undefined)).toBeNull()
  })

  it('maps the policy fields to settings', () => {
    expect(parseCollectionSettingsPatch({ compliance_cache_minutes: 15, compliance_guest_concurrency: 1 }))
      .toEqual({ cacheMinutes: 15, guestConcurrency: 1 })
    expect(parseCollectionSettingsPatch({ compliance_cache_minutes: 0 })).toEqual({ cacheMinutes: 0 })
  })

  it.each([
    [{ compliance_cache_minutes: 10 }],
    [{ compliance_cache_minutes: '5' }],
    [{ compliance_guest_concurrency: 0 }],
    [{ compliance_guest_concurrency: 11 }],
    [{ compliance_guest_concurrency: 3.5 }],
  ])('refuses %j instead of correcting it', body => {
    expect(() => parseCollectionSettingsPatch(body)).toThrow(E_COLLECTION_SETTINGS_INVALID)
  })
})

describe('collectionSettingsToPolicyFields', () => {
  it('names the fields as the Policies payload does', () => {
    expect(collectionSettingsToPolicyFields({ cacheMinutes: 1, guestConcurrency: 6 }))
      .toEqual({ compliance_cache_minutes: 1, compliance_guest_concurrency: 6 })
  })
})
