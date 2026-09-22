import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The stop button carried by every task row (#974) and the confirmation behind
// it. Also the migration wording the same confirmation reuses: a missing key
// renders its own path, since request.ts has no English fallback.
const requiredKeys = [
  'tasks.stop.action',
  'tasks.stop.confirmTitle',
  'tasks.stop.confirmBody',
  'tasks.stop.confirmBodyJob',
  'tasks.stop.confirmBodyUpload',
  'tasks.stop.keep',
  'tasks.stop.confirm',
  'tasks.stop.stopping',
  'tasks.shared.cancelConfirmStop',
  'tasks.shared.cancelConfirmLeftovers',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('stop-task i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every stop-task key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    // next-intl parses every message as ICU, where a brace opens a variable,
    // so an unescaped one throws at render time instead of printing.
    it(`${locale} keeps the stop-task messages free of ICU braces`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).not.toMatch(/[{}]/)
      }
    })
  }
})
