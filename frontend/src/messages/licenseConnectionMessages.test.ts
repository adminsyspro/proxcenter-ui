import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = [
  'settings.licenseConnectionTitle', 'settings.licenseConnectionNotConnected', 'settings.licenseConnectionOptIn', 'settings.licenseConnectionConnect',
  'settings.licenseConnectionPairingTitle', 'settings.licenseConnectionPairingHint', 'settings.licenseConnectionOpenPortal', 'settings.licenseConnectionPairingExpires',
  'settings.licenseConnectionCancel', 'settings.licenseConnectionInstance', 'settings.licenseConnectionCustomer',
  'settings.licenseConnectionLastCheckin', 'settings.licenseConnectionNextCheckin', 'settings.licenseConnectionNever', 'settings.licenseConnectionLeaseRemaining',
  'settings.licenseConnectionLeaseEnded',
  'settings.licenseConnectionClockSkew', 'settings.licenseConnectionHeldTitle', 'settings.licenseConnectionHeldNone', 'settings.licenseConnectionHeld',
  'settings.licenseConnectionLost', 'settings.licenseConnectionLostEnded', 'settings.licenseConnectionCheckinNow', 'settings.licenseConnectionCheckinQueued', 'settings.licenseConnectionDisconnect',
  'settings.licenseConnectionDisconnectConfirmTitle', 'settings.licenseConnectionDisconnectConfirm', 'settings.licenseConnectionDisconnected', 'settings.licenseConnectionFailures',
  'settings.licenseConnectionLastError', 'settings.licenseConnectionNextTry', 'settings.licenseConnectionRevoked', 'settings.licenseConnectionIdentityChanged',
  'settings.licenseConnectionReconnect', 'settings.licenseConnectionEnded', 'settings.licenseConnectionFailed', 'settings.licenseConnectionUnavailable',
  'settings.licenseConnectionConnectedTo', 'settings.licenseConnectionCloned', 'settings.licenseConnectionClonedReconnectHint',
  'settings.licenseBindingConnected', 'settings.licenseLeaseUntil', 'settings.licenseLeaseExpiredTitle', 'settings.licenseLeaseExpiredBody',
  'settings.licenseLeaseExpiredStep1', 'settings.licenseLeaseExpiredStep2', 'settings.licenseMovedExpiredTitle', 'settings.licenseMovedExpiredBody',
  'license.connectionFailing', 'license.connectionCloned', 'license.leaseExpiring', 'license.licenseLost', 'license.licenseLostEnded',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
}

describe('license connection i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key, non-empty, with the same placeholders as en`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(placeholders(value as string), `${locale}: ${key} placeholders`).toEqual(placeholders(get(en, key) as string))
      }
    })
  }
})

// A8: the plural rule (=0 / one / other) is real ICU syntax, not just a
// placeholder. A stray brace or an unknown plural category only throws at
// format time, never at JSON-parse time, so each locale needs an actual
// formatting pass for every day count that matters (0 = "less than a day",
// 1 = singular, 2 = plural). next-intl swallows format errors by default
// (it falls back to the key), so onError rethrows here to make a broken
// pattern fail the test instead of silently passing.
describe('lease day-count plurals format for days 0, 1 and 2 in every locale', () => {
  const pluralKeys = ['settings.licenseConnectionLeaseRemaining', 'settings.licenseConnectionLost', 'license.leaseExpiring', 'license.licenseLost']

  for (const [locale, messages] of Object.entries(locales)) {
    const t = createTranslator({
      locale,
      messages,
      onError: (error) => { throw error }
    }) as unknown as (key: string, values?: Record<string, unknown>) => string

    for (const key of pluralKeys) {
      for (const days of [0, 1, 2]) {
        it(`${locale} formats ${key} for days=${days} without throwing`, () => {
          let result = ''

          expect(() => { result = t(key, { days }) }).not.toThrow()
          expect(result.length, `${locale}: ${key} (days=${days}) is empty`).toBeGreaterThan(0)
          expect(result, `${locale}: ${key} (days=${days}) leaked ICU syntax`).not.toMatch(/[{}]/)
        })
      }
    }
  }
})

// A8: an ended lease/grace period never falls through to the "less than a
// day" plural branch; it has its own copy, with no day count argument.
describe('ended-lease copy formats in every locale', () => {
  const endedKeys = ['settings.licenseConnectionLeaseEnded', 'settings.licenseConnectionLostEnded', 'license.licenseLostEnded']

  for (const [locale, messages] of Object.entries(locales)) {
    const t = createTranslator({
      locale,
      messages,
      onError: (error) => { throw error }
    }) as unknown as (key: string) => string

    for (const key of endedKeys) {
      it(`${locale} formats ${key} without throwing`, () => {
        let result = ''

        expect(() => { result = t(key) }).not.toThrow()
        expect(result.length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(result, `${locale}: ${key} leaked ICU syntax`).not.toMatch(/[{}]/)
      })
    }
  }
})

// I1: the navbar's critical bell used a plain "{days} days" placeholder for
// these two keys, so a 1-day lease read as "1 days" and a same-day lease as
// "0 days". English is checked for the literal wrong text since it is the
// only locale where "N days" is unambiguous to grep for.
describe('license.leaseExpiring and license.licenseLost never print "0 days" or "1 days" (I1)', () => {
  const t = createTranslator({ locale: 'en', messages: en, onError: (error) => { throw error } }) as unknown as (key: string, values?: Record<string, unknown>) => string

  it.each(['license.leaseExpiring', 'license.licenseLost'])('%s singularises 1 day and never says "0 days"', key => {
    expect(t(key, { days: 1 })).not.toMatch(/\b1 days\b/)
    expect(t(key, { days: 0 })).not.toMatch(/\b0 days\b/)
    expect(t(key, { days: 0 })).toContain('less than a day')
  })
})

// M2: the opt-in disclosure must mention the rolling check-in token
// alongside the counter and timestamp it already listed, in every locale.
describe('settings.licenseConnectionOptIn mentions the check-in token (M2)', () => {
  const checkinTokenMentions: Record<string, string> = {
    en: 'check-in token',
    fr: 'jeton de check-in',
    de: 'Check-in-Token',
    es: 'token de check-in',
    ko: '체크인 토큰',
    'zh-CN': '签到令牌'
  }

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} mentions a check-in token before "Nothing else"`, () => {
      const value = get(messages, 'settings.licenseConnectionOptIn') as string

      expect(value, `${locale}: settings.licenseConnectionOptIn`).toContain(checkinTokenMentions[locale])
    })
  }
})
