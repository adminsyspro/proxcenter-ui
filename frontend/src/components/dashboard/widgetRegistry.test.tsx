import { describe, it, expect } from 'vitest'

import {
  WIDGET_REGISTRY, WIDGET_CATEGORIES, getWidgetsByCategory, isWidgetVisibleForScope,
} from './widgetRegistry'

/**
 * The registry is what the widget picker, the dashboard grid and the RBAC
 * screen all read, and a malformed entry only shows up at runtime as an
 * unknown widget card. These checks are cheap insurance on every entry.
 */

const entries = Object.entries(WIDGET_REGISTRY) as [string, Record<string, unknown>][]
const categoryIds = new Set(WIDGET_CATEGORIES.map(c => c.id))

describe('WIDGET_REGISTRY', () => {
  it('keys every entry by its own type', () => {
    for (const [key, def] of entries) expect(def.type).toBe(key)
  })

  it('gives every entry the fields the picker and the grid read', () => {
    for (const [key, def] of entries) {
      expect(def.name, key).toBeTruthy()
      expect(def.description, key).toBeTruthy()
      expect(def.icon, key).toBeTruthy()
      expect(def.component, key).toBeTruthy()
      expect(def.defaultSize, key).toBeTruthy()
    }
  })

  it('files every entry under a declared category', () => {
    for (const [key, def] of entries) expect(categoryIds.has(def.category as string), key).toBe(true)
  })

  it('registers the ZFS ARC widget under Resources, behind the infrastructure scope', () => {
    const def = WIDGET_REGISTRY['zfs-arc']

    expect(def).toBeTruthy()
    expect(def.category).toBe('resources')
    expect(def.requiresInfraScope).toBe(true)
    expect(def.defaultSize).toEqual({ w: 6, h: 5 })
  })
})

describe('getWidgetsByCategory', () => {
  it('returns the widgets of the asked category only', () => {
    const types = getWidgetsByCategory('resources').map(w => w.type)

    expect(types).toContain('zfs-arc')
    expect(types).toContain('infra-global-chart')
    expect(types).not.toContain('vm-heatmap') // infrastructure
  })

  it('never offers section headers, which have their own toolbar button', () => {
    const all = WIDGET_CATEGORIES.flatMap(c => getWidgetsByCategory(c.id).map(w => w.type))

    expect(all).not.toContain('section-header')
  })

  it('hides the infrastructure-scoped widgets from a user without that scope', () => {
    const types = getWidgetsByCategory('resources', { hasInfraScope: false }).map(w => w.type)

    expect(types).not.toContain('zfs-arc')
  })

  it('honours the per-role hidden widget list', () => {
    const types = getWidgetsByCategory('resources', { hiddenWidgets: new Set(['zfs-arc']) }).map(w => w.type)

    expect(types).not.toContain('zfs-arc')
    expect(types).toContain('infra-global-chart')
  })
})

describe('isWidgetVisibleForScope', () => {
  it('accepts a registered widget by default', () => {
    expect(isWidgetVisibleForScope('zfs-arc')).toBe(true)
  })

  it('rejects a type that is not registered', () => {
    expect(isWidgetVisibleForScope('does-not-exist')).toBe(false)
  })

  it('rejects an infrastructure-scoped widget without the scope', () => {
    expect(isWidgetVisibleForScope('zfs-arc', { hasInfraScope: false })).toBe(false)
  })

  it('rejects a widget hidden for the role', () => {
    expect(isWidgetVisibleForScope('zfs-arc', { hiddenWidgets: new Set(['zfs-arc']) })).toBe(false)
  })
})
