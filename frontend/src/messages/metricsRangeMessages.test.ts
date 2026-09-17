import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The custom range picker of the Performance cards reads these keys, and
// request.ts has no English fallback: a locale missing one renders its key
// path in the middle of the chart header (issue #955).
const KEYS: Record<string, string[]> = {
  custom: [],
  from: [],
  to: [],
  apply: [],
  reset: [],
  resolution: ['{step}'],
  invalidOrder: [],
  tooShort: ['{step}'],
  beyondRetention: ['{days}'],
  empty: [],
  dragHint: [],
  stepSeconds: ['{n}'],
  stepMinutes: ['{n}'],
  stepHours: ['{n}'],
}

describe('metrics range i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of Object.entries(KEYS)) {
      it(`${locale} declares ${key}${placeholders.length ? ` with ${placeholders.join(' and ')}` : ''}`, () => {
        const value = messages?.metricsRange?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        for (const placeholder of placeholders) {
          expect(value, `${locale}: ${key} ${placeholder}`).toContain(placeholder)
        }
      })
    }
  }
})
