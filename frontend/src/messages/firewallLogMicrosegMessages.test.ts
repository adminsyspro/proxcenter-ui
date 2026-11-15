/**
 * The Micro-segmentation source of the Logging tab (firewallLog.microseg): the same keys and ICU placeholders in the
 * 6 served locales, no empty string, no em dash, and translated rather than copied from English.
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

// Words that are the same in the language (Zone).
const SAME_AS_ENGLISH = new Set(['zone'])

const reference: Record<string, string> = (en.firewallLog as any).microseg

describe('firewallLog.microseg i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    const flat: Record<string, string> = messages.firewallLog.microseg

    it(`${locale} has every English key and no other`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
    })

    it(`${locale} has no empty string, no em dash and the same placeholders as English`, () => {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('')
        expect(value, `${locale}: ${key}`).not.toContain('—')
        expect(placeholders(value), `${locale}: ${key}`).toBe(placeholders(reference[key]))
      }
    })

    if (locale !== 'en') {
      it(`${locale} is translated, not copied from English`, () => {
        const same = Object.keys(reference).filter(key => flat[key] === reference[key] && !SAME_AS_ENGLISH.has(key))

        expect(same).toEqual([])
      })
    }
  }
})
