import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = ['about.updateCheckOffline']

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('air-gapped i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key, non-empty and brace-free`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(value, `${locale}: ${key}`).not.toMatch(/[{}]/)
      }
    })
  }
})
