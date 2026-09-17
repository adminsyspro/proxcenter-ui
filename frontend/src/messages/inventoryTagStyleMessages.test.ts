import { describe, expect, it } from 'vitest'

import { INVENTORY_TAG_STYLE_OPTIONS } from '@configs/inventoryTagStyleConfig'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The card's own strings, plus one label per shape the card offers: a style
// added to the config with no message would render its key path, since
// request.ts has no English fallback.
const requiredKeys = [
  'settings.inventoryTagStyle.title',
  'settings.inventoryTagStyle.desc',
  'settings.inventoryTagStyle.autoHint',
  ...INVENTORY_TAG_STYLE_OPTIONS.map(option => option.labelKey),
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('inventory tag style i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every inventory tag style key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    // next-intl parses every message as ICU, where a brace opens a variable,
    // so an unescaped one throws at render time instead of printing.
    it(`${locale} keeps the inventory tag style messages free of ICU braces`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).not.toMatch(/[{}]/)
      }
    })
  }
})
