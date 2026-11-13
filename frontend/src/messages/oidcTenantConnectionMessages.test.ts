import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Settings > OIDC / SSO > Tenants: each tenant's own identity provider (issue #1289).
const keys = [
  'tabProvider', 'tabTenants', 'listDescription', 'empty', 'statusActive', 'statusDisabled', 'statusNotConfigured',
  'formTitle', 'formDescription', 'back', 'loginUrl', 'allowedDomains', 'allowedDomainsHelper',
  'delete', 'deleteTitle', 'deleteConfirm', 'deleteError', 'loadError',
  'tenantTabLabel', 'managedByProvider', 'selfService', 'selfServiceDesc', 'selfServiceShort', 'allowedDomainsLocked',
].map(key => `oidc.tenantConnections.${key}`)

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('tenant OIDC connection i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every tenant connection key`, () => {
      for (const key of keys) expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
    })
  }

  it('keeps the {tenant} placeholder of the form title in every locale', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      expect(get(messages, 'oidc.tenantConnections.formTitle'), locale).toContain('{tenant}')
    }
  })
})
