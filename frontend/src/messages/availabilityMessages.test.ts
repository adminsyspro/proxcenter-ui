import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

/** Every leaf of an object, as dotted paths. */
function leaves(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`])
}

const get = (obj: any, path: string) => path.split('.').reduce((o, k) => o?.[k], obj)

/** Every `{marker}` of a message, ICU plural and select bodies excluded. */
const markers = (value: string) => [...value.matchAll(/\{(\w+)/g)].map(m => m[1]).sort()

const reference = leaves((en as any).availability)

describe('Availability and SLA i18n parity across the 6 served locales', () => {
  it('names the page, the three tabs and the five states in English', () => {
    expect(reference).toContain('title')
    for (const t of ['overview', 'policies', 'maintenance']) expect(reference).toContain(`tabs.${t}`)
    for (const s of ['up', 'down', 'maintenance', 'unobserved', 'absent']) expect(reference).toContain(`states.${s}`)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of availability`, () => {
      const tree = messages?.availability
      expect(tree, locale).toBeTypeOf('object')
      expect(leaves(tree).sort()).toEqual([...reference].sort())
      for (const path of reference) {
        const value = get(tree, path)
        expect(value, `${locale}: ${path}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ${path} is empty`).not.toBe('')
        expect(value, `${locale}: ${path} has an em-dash`).not.toContain('—')
      }
    })

    it(`${locale} keeps the markers of every message`, () => {
      for (const path of reference) {
        expect(markers(get(messages.availability, path)), `${locale}: ${path}`).toEqual(markers(get((en as any).availability, path)))
      }
    })

    it(`${locale} labels the menu entry`, () => {
      expect(messages?.navigation?.availability, locale).toBeTypeOf('string')
      expect(messages.navigation.availability.trim(), locale).not.toBe('')
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      expect(locales[locale].availability.title, locale).not.toBe((en as any).availability.title)
      expect(locales[locale].availability.states.unobserved, locale).not.toBe((en as any).availability.states.unobserved)
    }
  })
})
