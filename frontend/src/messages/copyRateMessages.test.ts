import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

// Copy rate cap of warm migrations: the fields, the live change dialog and the setting of a source connection.
const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const keys = [
  'button', 'label', 'unlimited', 'unit', 'help', 'sharedHelp', 'schedule', 'from', 'to', 'timeZone', 'offHours',
  'dialogTitle', 'dialogTitleBatch', 'dialogBody', 'dialogBodyBatch', 'inForce', 'perHostNote', 'remove', 'apply',
  'perHostTitle', 'perHostInfo', 'perHost', 'perHostCaption',
]
const placeholders: Record<string, string> = { timeZone: '{tz}', inForce: '{rate}', perHostNote: '{rate}' }

describe('copy rate messages', () => {
  for (const [name, messages] of Object.entries(locales)) {
    it(`${name} has every string, no em-dash, and keeps the placeholders`, () => {
      for (const k of keys) {
        const v = messages.copyRate?.[k]
        expect(typeof v, k).toBe('string')
        expect(v.length, k).toBeGreaterThan(0)
        expect(v, k).not.toContain('—')
        if (placeholders[k]) expect(v, k).toContain(placeholders[k])
      }
    })
  }
})
