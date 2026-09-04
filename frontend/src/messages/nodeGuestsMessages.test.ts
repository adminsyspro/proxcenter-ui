import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

describe('Guests per Node widget (#856) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} names and describes the widget in the catalogue`, () => {
      expect(messages?.dashboard?.widgetNames?.nodeGuests, `${locale}: widgetNames.nodeGuests`).toBeTypeOf('string')
      expect(messages?.dashboard?.widgetDescs?.nodeGuests, `${locale}: widgetDescs.nodeGuests`).toBeTypeOf('string')
    })

    for (const key of ['guests', 'running', 'nodes']) {
      it(`${locale} declares dashboard.nodeGuests.${key} with its {count} placeholder`, () => {
        const value = messages?.dashboard?.nodeGuests?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value, `${locale}: {count} placeholder`).toContain('{count}')
      })
    }

    // The toolbar reuses these two shared keys; de.json did not have them.
    for (const key of ['expandAll', 'collapseAll']) {
      it(`${locale} declares common.${key}`, () => {
        const value = messages?.common?.[key]

        expect(value, `${locale}: common.${key}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: common.${key} must not be empty`).toBeGreaterThan(0)
      })
    }
  }
})
