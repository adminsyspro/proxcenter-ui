import { describe, expect, it } from 'vitest'

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
  'settings.licenseConnectionCancel', 'settings.licenseConnectionConnected', 'settings.licenseConnectionInstance', 'settings.licenseConnectionCustomer',
  'settings.licenseConnectionLastCheckin', 'settings.licenseConnectionNextCheckin', 'settings.licenseConnectionNever', 'settings.licenseConnectionLeaseRemaining',
  'settings.licenseConnectionClockSkew', 'settings.licenseConnectionHeldTitle', 'settings.licenseConnectionHeldNone', 'settings.licenseConnectionHeld',
  'settings.licenseConnectionLost', 'settings.licenseConnectionCheckinNow', 'settings.licenseConnectionCheckinQueued', 'settings.licenseConnectionDisconnect',
  'settings.licenseConnectionDisconnectConfirmTitle', 'settings.licenseConnectionDisconnectConfirm', 'settings.licenseConnectionDisconnected', 'settings.licenseConnectionFailures',
  'settings.licenseConnectionLastError', 'settings.licenseConnectionNextTry', 'settings.licenseConnectionRevoked', 'settings.licenseConnectionIdentityChanged',
  'settings.licenseConnectionReconnect', 'settings.licenseConnectionEnded', 'settings.licenseConnectionFailed', 'settings.licenseConnectionUnavailable',
  'settings.licenseBindingConnected', 'settings.licenseLeaseUntil', 'settings.licenseLeaseExpiredTitle', 'settings.licenseLeaseExpiredBody',
  'settings.licenseLeaseExpiredStep1', 'settings.licenseLeaseExpiredStep2',
  'license.connectionFailing', 'license.leaseExpiring', 'license.licenseLost',
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
