import { describe, expect, it } from 'vitest'

import { isOfflineMode } from './offline'

describe('isOfflineMode', () => {
  it('is off by default and on empty or unknown values', () => {
    expect(isOfflineMode({})).toBe(false)
    expect(isOfflineMode({ PROXCENTER_OFFLINE: '' })).toBe(false)
    expect(isOfflineMode({ PROXCENTER_OFFLINE: 'false' })).toBe(false)
    expect(isOfflineMode({ PROXCENTER_OFFLINE: 'maybe' })).toBe(false)
  })

  it('accepts the usual truthy spellings, whatever the case', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' Yes ']) expect(isOfflineMode({ PROXCENTER_OFFLINE: v }), v).toBe(true)
  })
})
