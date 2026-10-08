import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Users page: cumulated SSO roles and who owns them (issue #1074). de.json has
// no English fallback, a missing key renders as its path.
const requiredKeys = [
  'currentRoles',
  'roleOriginManual',
  'rolesManagedByProvider',
  'roleOverrideAction',
  'roleOverrideWarning',
  'roleSetManually',
  'roleHandBackAction',
  'roleHandBackPending',
  'rolesMixed',
  'rolesDivergentWarning',
]

describe('Users page role origin i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every role origin key`, () => {
      for (const key of requiredKeys) {
        expect(messages.usersPage?.[key], `${locale}: usersPage.${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} keeps the {provider} placeholder`, () => {
      for (const key of ['rolesManagedByProvider', 'roleOverrideWarning', 'roleSetManually', 'roleHandBackAction', 'roleHandBackPending']) {
        expect(messages.usersPage[key], `${locale}: usersPage.${key}`).toContain('{provider}')
      }
    })
  }
})
