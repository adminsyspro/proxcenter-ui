import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The tenant / vDC columns of the OIDC group mapping. `oidc.groupMappingDesc`
// is listed too because the ldap block carries a key of that exact name earlier
// in every file: an insertion anchored on the first match lands in the WRONG
// block and the form then renders the raw key names.
const requiredKeys = [
  'oidc.groupMappingDesc',
  'oidc.groupMappingScopedDesc',
  'oidc.tenant',
  'oidc.vdc',
  'oidc.vdcWholeTenant',
  // Federated logout: the URLs the admin must declare at the IdP.
  'oidc.registerUrlsTitle',
  'oidc.registerCallbackUrl',
  'oidc.registerPostLogoutUrl',
  'oidc.registerPostLogoutHelp',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('OIDC group mapping tenant/vDC i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every group mapping scope key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} did not leak the scope keys into the ldap block`, () => {
      for (const key of ['tenant', 'vdc', 'vdcWholeTenant', 'groupMappingScopedDesc']) {
        expect(messages.ldap?.[key], `${locale}: ldap.${key}`).toBeUndefined()
      }
    })
  }
})
