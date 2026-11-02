/**
 * The Micro-segmentation tab (microsegPilot namespace) must exist in the 6
 * served locales, with the same keys and the same ICU placeholders, and every
 * error code the API client can raise must have a message.
 */

import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const ERROR_CODES = [
  'VERSION_CONFLICT', 'BUSY', 'ZONE_NAME_TAKEN', 'IN_USE', 'INVALID', 'FEATURE_REQUIRED', 'FORBIDDEN', 'NOT_FOUND',
  'UNAUTHORIZED', 'NOT_LEADER', 'MICROSEG_UNAVAILABLE', 'ENGINE_STOPPED', 'ORCHESTRATOR_ERROR', 'ORCHESTRATOR_TIMEOUT',
  'PVE_ERROR', 'CONFLICT', 'NETWORK', 'generic',
]

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  if (!node || typeof node !== 'object') return {}
  return Object.entries(node).reduce<Record<string, string>>(
    (acc, [key, value]) => Object.assign(acc, flatten(value, prefix ? `${prefix}.${key}` : key)),
    {},
  )
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map(m => m[1]).sort().join(',')

const reference = flatten(en.microsegPilot)

describe('microsegPilot i18n parity across the 6 served locales', () => {
  it('declares the namespace in English', () => {
    expect(Object.keys(reference).length).toBeGreaterThan(40)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    const flat = flatten(messages.microsegPilot)

    it(`${locale} has every English key and no other`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
    })

    it(`${locale} has no empty string and the same placeholders as English`, () => {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('')
        expect(placeholders(value), `${locale}: ${key}`).toBe(placeholders(reference[key]))
      }
    })

    it(`${locale} has a message for every error code`, () => {
      for (const code of ERROR_CODES) {
        expect(flat[`errors.${code}`], `${locale}: errors.${code}`).toBeTypeOf('string')
      }
    })
  }

  it('is translated, not copied from English', () => {
    // Proper nouns and words that are the same in a language (Plan, Zones, Type, Page, Observation...) may coincide:
    // each locale has its own ceiling, set just above what it legitimately shares.
    const ceilings: Record<string, number> = { fr: 16, de: 11, es: 5, ko: 3, 'zh-CN': 3 }
    for (const [locale, ceiling] of Object.entries(ceilings)) {
      const flat = flatten(locales[locale].microsegPilot)
      const same = Object.keys(reference).filter(key => flat[key] === reference[key])
      expect(same.length, `${locale}: ${same.join(', ')}`).toBeLessThanOrEqual(ceiling)
    }
  })
})
