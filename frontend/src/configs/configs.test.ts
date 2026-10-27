import { describe, expect, it } from 'vitest'

import globalThemesConfig, { densityConfig, getGlobalTheme, getThemesByCategory, themeCategories, transitionConfig } from './globalThemesConfig'
import lightBackgroundConfig, { getLightBackground } from './lightBackgroundConfig'

describe('getGlobalTheme', () => {
  it('finds a theme by id and falls back to the first one', () => {
    expect(getGlobalTheme('terminal').id).toBe('terminal')
    expect(getGlobalTheme('nope')).toBe(globalThemesConfig[0])
    expect(getGlobalTheme(undefined)).toBe(globalThemesConfig[0])
  })
})

describe('getThemesByCategory', () => {
  it('returns every theme for all or no category, else the category members', () => {
    expect(getThemesByCategory('all')).toBe(globalThemesConfig)
    expect(getThemesByCategory(undefined)).toBe(globalThemesConfig)
    const ide = getThemesByCategory('ide')
    expect(ide.length).toBeGreaterThan(0)
    expect(ide.every(t => t.category === 'ide')).toBe(true)
  })

  it('covers every theme with a declared category and density/transition', () => {
    const categories = new Set(themeCategories.map(c => c.id))
    for (const t of globalThemesConfig) {
      expect(categories.has(t.category)).toBe(true)
      expect(densityConfig[t.styles.density]).toBeDefined()
      expect(transitionConfig[t.styles.transitions]).toBeDefined()
    }
  })
})

describe('getLightBackground', () => {
  it('finds a tint by id and falls back to the first one', () => {
    expect(getLightBackground('sepia').id).toBe('sepia')
    expect(getLightBackground('nope')).toBe(lightBackgroundConfig[0])
    expect(getLightBackground(undefined)).toBe(lightBackgroundConfig[0])
  })
})
