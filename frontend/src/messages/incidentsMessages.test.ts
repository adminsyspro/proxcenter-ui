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

const reference = leaves((en as any).incidents)

describe('Incident register i18n parity across the 6 served locales', () => {
  it('names the statuses and the error codes in English', () => {
    for (const s of ['open', 'resolved', 'closed']) expect(reference).toContain(`status.${s}`)
    for (const e of ['alertInIncident', 'closed', 'notResolved', 'alreadyAttached', 'generic']) expect(reference).toContain(`errors.${e}`)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of incidents`, () => {
      const tree = messages?.incidents
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
        expect(markers(get(messages.incidents, path)), `${locale}: ${path}`).toEqual(markers(get((en as any).incidents, path)))
      }
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      expect(locales[locale].incidents.status.resolved, locale).not.toBe((en as any).incidents.status.resolved)
      expect(locales[locale].incidents.errors.generic, locale).not.toBe((en as any).incidents.errors.generic)
    }
  })
})
