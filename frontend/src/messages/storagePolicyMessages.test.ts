import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'vdc.storagePoliciesTitle',
  'vdc.storagePoliciesHint',
  'vdc.storagePolicyAdd',
  'vdc.storagePolicyName',
  'vdc.storagePolicyStorage',
  'vdc.storagePolicyStorageTaken',
  'vdc.storagePolicyDescription',
  'vdc.storagePolicyIopsRd',
  'vdc.storagePolicyIopsWr',
  'vdc.storagePolicyMbpsRd',
  'vdc.storagePolicyMbpsWr',
  'vdc.storagePolicyInUse',
  'vdc.storagePolicyVdcCount',
  'vdc.storagePolicyApplyTitle',
  'vdc.storagePolicyApplyRunning',
  'vdc.storagePolicyApplyDone',
  'vdc.storagePolicyApplyError',
  'vdc.storagePolicyNoDisks',
  'vdc.storagePolicyDiskDrift',
  'vdc.vdcPoliciesTitle',
  'vdc.vdcPoliciesHint',
  'vdc.vdcPolicyAdd',
  'vdc.vdcPolicyQuotaGb',
  'vdc.vdcPolicyUnlimited',
  'hardware.qosManagedByPolicy',
  'myVdc.storageTiersTitle',
  'myVdc.storageTierUsage',
]

// vdc.storagePolicyInUse is an ICU plural string (`{count, plural, =1 {...} other {...}}`)
// in all 6 locales. It is excluded from the plain placeholderSet/sameSet mechanics below
// because the naive `{[^}]+}` regex would capture the translated plural branches instead
// of the `{count}` token, and would therefore report a false mismatch on every non-en
// locale. It gets its own dedicated ICU-shape assertion instead.
const icuPluralKey = 'vdc.storagePolicyInUse'
const tokenCheckedKeys = requiredKeys.filter((key) => key !== icuPluralKey)

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

/** Extract the set of `{placeholder}` tokens from a message string. */
function placeholderSet(value: unknown): Set<string> {
  const str = typeof value === 'string' ? value : ''
  return new Set(str.match(/\{[^}]+\}/g) ?? [])
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((token) => b.has(token))
}

describe('vDC storage policy i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every storage policy key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} neither drops nor invents a {placeholder} relative to en`, () => {
      for (const key of tokenCheckedKeys) {
        const enPlaceholders = placeholderSet(get(en, key))
        const localePlaceholders = placeholderSet(get(messages, key))
        expect(
          sameSet(localePlaceholders, enPlaceholders),
          `${locale}: ${key} has {${[...localePlaceholders].join(', ')}}, en has {${[...enPlaceholders].join(', ')}}`,
        ).toBe(true)
      }
    })

    it(`${locale} keeps the ICU plural shape of storagePolicyInUse`, () => {
      const value = get(messages, icuPluralKey)
      expect(value, locale).toBeTypeOf('string')
      const str = value as string
      expect(str.startsWith('{count, plural,'), `${locale}: ${str}`).toBe(true)
      expect(str.includes('=1 {'), `${locale}: ${str}`).toBe(true)
      expect(str.includes('other {'), `${locale}: ${str}`).toBe(true)
    })
  }
})
