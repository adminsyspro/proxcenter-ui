/**
 * The Dashboard tab of /automation/network and the rules read on demand (networkPage.dashboard and
 * networkPage.rulesOnDemand, UA44): the same keys and ICU placeholders in the 6 served locales, no empty string, no
 * em dash.
 */

import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map(m => m[1]).sort().join(',')

for (const namespace of ['dashboard', 'rulesOnDemand', 'vmPager'] as const) {
  const reference: Record<string, string> = (en.networkPage as any)[namespace]

  describe(`networkPage.${namespace} i18n parity across the 6 served locales`, () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const flat: Record<string, string> = messages.networkPage[namespace]

      it(`${locale} has every English key and no other`, () => {
        expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
      })

      it(`${locale} has no empty string, no em dash and the same placeholders as English`, () => {
        for (const [key, value] of Object.entries(flat)) {
          expect(value.trim(), `${locale}: ${key}`).not.toBe('')
          expect(value, `${locale}: ${key}`).not.toContain('\u2014')
          expect(placeholders(value), `${locale}: ${key}`).toBe(placeholders(reference[key]))
        }
      })
    }
  })
}
