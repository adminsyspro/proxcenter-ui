import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

// ui#1332: the bulk migration limits of a connection and the caption of the bulk dialog.
const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const settingsKeys = [
  'migrationLimits', 'migrationLimitsTargetInfo', 'migrationLimitsSourceInfo', 'migrationMaxParallel',
  'migrationMaxPerNode', 'migrationMaxPerSourceHost', 'migrationLimitsTargetCaption', 'migrationLimitsSourceCaption',
]

describe('bulk migration limit messages', () => {
  for (const [name, messages] of Object.entries(locales)) {
    it(`${name} has every string, no em-dash, and the dialog caption keeps its placeholders`, () => {
      for (const k of settingsKeys) {
        const v = messages.settings[k]
        expect(typeof v, k).toBe('string')
        expect(v.length, k).toBeGreaterThan(3)
        expect(v, k).not.toContain('—')
      }
      const caption = messages.inventoryPage.esxiMigration.bulkConcurrencyLimits
      expect(caption).toContain('{perNode}')
      expect(caption).toContain('{cluster}')
      expect(caption).not.toContain('—')
    })
  }
})
