import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

describe('guests behind a network count (#1290) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of ['guest', 'node', 'interfaces', 'bridge']) {
      it(`${locale} declares inventory.networkGuests.${key}`, () => {
        const value = messages?.inventory?.networkGuests?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: ${key} must not be empty`).toBeGreaterThan(0)
      })
    }

    it(`${locale} declares inventory.networkGuests.toggle with its {name} placeholder`, () => {
      expect(messages?.inventory?.networkGuests?.toggle, `${locale}: toggle`).toContain('{name}')
    })
  }
})
