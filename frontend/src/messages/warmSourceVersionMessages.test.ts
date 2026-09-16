import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The migrate dialog composes the #946 source-version verdict from these five
// keys and the values the route sends, so a locale missing one renders its key
// path: request.ts has no English fallback.
const KEYS: Record<string, string[]> = {
  warmSourceTooOldTitle: [],
  warmSourceTooOld: ['{version}', '{min}'],
  warmSourceNodeVddk: ['{vddk}', '{min}'],
  warmSourceUseCold: [],
  warmSourceOutsideMatrix: ['{version}', '{min}'],
}

describe('warm source version i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of Object.entries(KEYS)) {
      it(`${locale} declares ${key}${placeholders.length ? ` with ${placeholders.join(' and ')}` : ''}`, () => {
        const value = messages?.inventoryPage?.esxiMigration?.[key]
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        for (const placeholder of placeholders) {
          expect(value, `${locale}: ${key} ${placeholder}`).toContain(placeholder)
        }
      })
    }
  }
})
