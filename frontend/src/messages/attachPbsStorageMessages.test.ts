import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = Object.keys(en.storage.attachPbs)

describe('PBS storage attach i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every English attach key with a non-empty string`, () => {
      const block: Record<string, unknown> = messages.storage.attachPbs

      expect(requiredKeys.length).toBeGreaterThan(0)

      for (const key of requiredKeys) {
        expect(block, `${locale}: missing ${key}`).toHaveProperty(key)
        expect(block[key], `${locale}: ${key}`).toBeTypeOf('string')
        expect((block[key] as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} preserves storage and cluster placeholders`, () => {
      expect(messages.storage.attachPbs.alreadyAttached, locale).toContain('{storage}')
      expect(messages.storage.attachPbs.detachTitle, locale).toContain('{storage}')
      expect(messages.storage.attachPbs.detachTokenKept, locale).toContain('{clusters}')
    })
  }
})
