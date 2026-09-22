import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Every string the Node Summary builds for #969, with the placeholders each one
// must keep: a translation that drops one silently prints a blank figure.
const KEYS: Record<string, string[]> = {
  titleCpu: [],
  titleMemory: [],
  runningGuests: ['{count', '#'],
  allGuests: ['{count', '#'],
  ratioOfCapacity: ['{ratio}'],
  capacityCpu: ['{logicalCpus}'],
  capacityMemory: ['{value}'],
  vcpu: ['{value}'],
  chipAria: ['{ratio}'],
  markerCpu: ['{value}'],
  markerMemory: ['{value}'],
}

describe('Node Summary provisioned resources (#969) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of Object.entries(KEYS)) {
      it(`${locale} declares inventory.provisioning.${key}${placeholders.length ? ' with its placeholders' : ''}`, () => {
        const value = messages?.inventory?.provisioning?.[key]

        expect(value, `${locale}: inventory.provisioning.${key}`).toBeTypeOf('string')
        expect(value.length, `${locale}: must not be empty`).toBeGreaterThan(0)

        for (const placeholder of placeholders) {
          expect(value, `${locale}: ${key} keeps ${placeholder}`).toContain(placeholder)
        }
      })
    }

    it(`${locale} declares an "other" plural form on both guest counts`, () => {
      // ICU falls back to `other`, so a form that only spells `one` prints
      // nothing for every count but 1.
      for (const key of ['runningGuests', 'allGuests']) {
        expect(messages?.inventory?.provisioning?.[key], `${locale}: ${key}`).toContain('other {')
      }
    })

    it(`${locale} keeps the two tooltip row labels distinct`, () => {
      // They sit one above the other in the same tooltip; the same wording twice
      // would make the running figure and the total unreadable.
      const p = messages?.inventory?.provisioning

      expect(p?.runningGuests, `${locale}: runningGuests vs allGuests`).not.toBe(p?.allGuests)
      expect(p?.titleCpu, `${locale}: titleCpu vs titleMemory`).not.toBe(p?.titleMemory)
    })
  }
})
