import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = ['downloadPdf', 'downloadCsv'] as const

describe('report download i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} names both download formats`, () => {
      const block = messages.reports as Record<string, unknown>

      for (const key of requiredKeys) {
        expect(block, `${locale}: missing ${key}`).toHaveProperty(key)
        expect(block[key], `${locale}: ${key}`).toBeTypeOf('string')
        expect((block[key] as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })
  }
})
