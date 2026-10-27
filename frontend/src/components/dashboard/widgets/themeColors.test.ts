import { describe, expect, it } from 'vitest'

import { NODE_COLORS, widgetColors } from './themeColors'

describe('NODE_COLORS', () => {
  it('holds 16 distinct hex colours', () => {
    expect(NODE_COLORS).toHaveLength(16)
    expect(new Set(NODE_COLORS).size).toBe(16)
    for (const c of NODE_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('widgetColors', () => {
  it('returns the same keys for both modes with mode-specific values', () => {
    const dark = widgetColors(true)
    const light = widgetColors(false)
    expect(Object.keys(dark)).toEqual(Object.keys(light))
    expect(dark.textPrimary).toBe('rgba(255,255,255,0.85)')
    expect(light.textPrimary).toBe('rgba(0,0,0,0.55)')
    expect(dark.tooltipBg).toBe('#1e1e2d')
    expect(light.tooltipBg).toBe('#fff')
    expect(dark.dotBorder).toBe(dark.tooltipBg)
    expect(light.dotBorder).toBe(light.tooltipBg)
  })
})
