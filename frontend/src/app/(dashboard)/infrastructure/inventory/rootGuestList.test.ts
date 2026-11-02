import { describe, it, expect } from 'vitest'

import { showRootGuestList } from './rootGuestList'

describe('showRootGuestList', () => {
  it('shows the guest list when the vms view has guests', () => {
    expect(showRootGuestList('vms', 3, false)).toBe(true)
    expect(showRootGuestList('vms', 3, true)).toBe(true)
  })

  // Issue #1271: a fresh vDC tenant has no guest yet, and the list header is
  // the only place carrying "Deploy from template" and "Create VM".
  it('keeps the guest list, and its create actions, once an empty inventory has loaded', () => {
    expect(showRootGuestList('vms', 0, true)).toBe(true)
  })

  it('keeps the placeholder while the first inventory load is still running', () => {
    expect(showRootGuestList('vms', 0, false)).toBe(false)
  })

  it('never shows the guest list in the other view modes', () => {
    for (const mode of ['tree', 'hosts', 'pools', 'tags', 'favorites', 'templates'] as const) {
      expect(showRootGuestList(mode, 3, true)).toBe(false)
    }
  })
})
