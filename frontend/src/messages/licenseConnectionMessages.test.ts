import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Connection strings the License tab still reads outside settings.licenseTab,
// and the navbar bell items.
const requiredKeys = [
  'settings.licenseConnectionOptIn', 'settings.licenseConnectionOpenPortal', 'settings.licenseConnectionPairingExpires',
  'settings.licenseConnectionCancel', 'settings.licenseConnectionCheckinQueued', 'settings.licenseConnectionDisconnect',
  'settings.licenseConnectionDisconnectConfirmTitle', 'settings.licenseConnectionDisconnectConfirm',
  'settings.licenseConnectionFailed', 'settings.licenseConnectionUnavailable',
  'license.connectionFailing', 'license.connectionCloned', 'license.leaseExpiring', 'license.licenseLost', 'license.licenseLostEnded',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

// Every leaf path under a subtree, e.g. settings.licenseTab.alerts.quota.title.
function leaves(node: any, prefix: string): string[] {
  return Object.entries(node).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${prefix}.${k}`) : [`${prefix}.${k}`]))
}

// Argument names, simple ({date}) and ICU ({days, plural, ...}) alike.
function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{\s*(\w+)\s*[,}]/g)].map(m => m[1]))].sort()
}

const tabKeys = leaves(en.settings.licenseTab, 'settings.licenseTab')

describe('license tab i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key, non-empty, with the same placeholders as en`, () => {
      for (const key of [...requiredKeys, ...tabKeys]) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(placeholders(value as string), `${locale}: ${key} placeholders`).toEqual(placeholders(get(en, key) as string))
      }
    })

    it(`${locale} has no license tab key that en lacks`, () => {
      expect(leaves(get(messages, 'settings.licenseTab'), 'settings.licenseTab').filter(k => !tabKeys.includes(k))).toEqual([])
    })
  }
})

// The plural rules (=0 / one / other) are real ICU syntax: a stray brace or
// an unknown category only throws at format time, and next-intl falls back
// to the key by default, so onError rethrows to make a broken pattern fail.
// Every message is formatted with 0, 1 and 2 for the counts it takes.
describe('license tab messages format in every locale', () => {
  const sample = (n: number) => ({
    days: n, count: n, failures: n, over: n, used: 10, max: 8, minutes: 6,
    date: '30/09/2027', since: '28/09/2026 14:30', next: '30/09/2026 14:30', until: '28/10/2026',
    label: 'Enterprise', licenseId: 'lic-1', name: 'Lab A', ago: '3 min', host: 'proxcenter.io',
  })

  for (const [locale, messages] of Object.entries(locales)) {
    const t = createTranslator({ locale, messages, onError: (error) => { throw error } }) as unknown as (key: string, values?: Record<string, unknown>) => string

    it(`${locale} formats every license tab message for counts 0, 1 and 2`, () => {
      for (const key of [...tabKeys, 'license.leaseExpiring', 'license.licenseLost']) {
        for (const n of [0, 1, 2]) {
          let result = ''

          expect(() => { result = t(key, sample(n)) }, `${locale}: ${key} (${n})`).not.toThrow()
          expect(result.length, `${locale}: ${key} (${n}) is empty`).toBeGreaterThan(0)
          expect(result, `${locale}: ${key} (${n}) leaked ICU syntax`).not.toMatch(/[{}]/)
          expect(result, `${locale}: ${key} (${n}) reads "1 days"`).not.toMatch(/\b1 days\b/)
        }
      }
    })
  }
})
