import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Datacenter User Tag Access (#1207, #1208): one help line per mode the
// select offers, the allow-list field, and the tag editor's hints. A missing
// key renders its path, since request.ts has no English fallback.
const requiredKeys = [
  ...['free', 'list', 'existing', 'none'].map(mode => `inventory.dcSettingsUserTagAccessHelp_${mode}`),
  'inventory.dcSettingsUserTagAllowList',
  'inventory.dcSettingsUserTagAllowListHelp',
  'inventory.dcSettingsRegisteredTagsHelp',
  'inventory.tagAccessReadOnly',
  'inventory.tagAccessNoNewTags',
  'inventory.tagAccessLocked',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('user tag access i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every user tag access key with a non-empty, brace-free value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(value as string, `${locale}: ${key} has an ICU brace`).not.toMatch(/[{}]/)
      }
    })
  }
})
