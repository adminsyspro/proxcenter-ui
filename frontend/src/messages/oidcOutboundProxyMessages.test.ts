import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The outbound proxy section of the OIDC tab and the discovery test messages
// (roadmap#78). de.json has no English fallback: a missing key renders its path.
const requiredKeys = [
  'oidc.proxySection',
  'oidc.proxyDesc',
  'oidc.proxyUrl',
  'oidc.proxyUrlHelper',
  'oidc.proxyUrlHelperEnv',
  'oidc.proxyUsername',
  'oidc.proxyUsernameHelper',
  'oidc.proxyPassword',
  'oidc.proxyPasswordKeep',
  'oidc.proxyBypass',
  'oidc.proxyBypassHelper',
  'oidc.testViaProxy',
  'oidc.testViaDirect',
  'oidc.testError.dns',
  'oidc.testError.dnsDirect',
  'oidc.testError.timeout',
  'oidc.testError.unreachable',
  'oidc.testError.proxy_auth',
  'oidc.testError.proxy_refused',
  'oidc.testError.tls',
]

// Placeholders the form fills in; a translation that drops one loses the value.
const placeholders: Record<string, string[]> = {
  'oidc.proxyUrlHelperEnv': ['{proxy}'],
  'oidc.testViaProxy': ['{proxy}'],
  'oidc.testError.dns': ['{host}'],
  'oidc.testError.dnsDirect': ['{host}'],
  'oidc.testError.timeout': ['{host}'],
  'oidc.testError.unreachable': ['{host}'],
  'oidc.testError.proxy_refused': ['{status}'],
  'oidc.testError.tls': ['{host}'],
}

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('OIDC outbound proxy i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every outbound proxy key with its placeholders`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
      for (const [key, names] of Object.entries(placeholders)) {
        for (const name of names) expect(get(messages, key), `${locale}: ${key}`).toContain(name)
      }
    })
  }
})
