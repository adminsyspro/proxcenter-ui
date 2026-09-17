import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'settings.basemap.title',
  'settings.basemap.desc',
  'settings.basemap.provider',
  'settings.basemap.providerOsm',
  'settings.basemap.providerCustom',
  'settings.basemap.lightUrl',
  'settings.basemap.lightUrlHelp',
  'settings.basemap.darkUrl',
  'settings.basemap.darkUrlHelp',
  'settings.basemap.attribution',
  'settings.basemap.attributionHelp',
  'settings.basemap.invalidTemplate',
  'settings.basemap.readOnly',
  'settings.basemap.saved',
  'settings.basemap.saveFailed',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('basemap settings i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every basemap key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    // next-intl parses every message as ICU, where a brace opens a variable.
    // An unescaped {z} in a help text throws at render time instead of
    // printing the tile placeholder, so these strings must stay brace-free —
    // the literal template lives in the field's placeholder attribute.
    it(`${locale} keeps the basemap messages free of ICU braces`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).not.toMatch(/[{}]/)
      }
    })
  }
})
