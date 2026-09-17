import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The same guest may sit in several recovery plans (roadmap#4), which the
// plan dialog and the plan details now say rather than forbid, and an
// orchestrator that dropped the connection mid-action is reported after a
// refresh (roadmap#8). A locale missing one of these keys shows the operator
// the raw key path: de.json has no English fallback of any kind.
const requiredKeys = [
  'siteRecovery.createPlan.vmInOtherPlans',
  'siteRecovery.plans.sharesGuestsWith',
  'siteRecovery.plans.alsoInPlan',
  'siteRecovery.failover.unavailableRefreshed',
]

// Each sentence names the plan(s) through a placeholder; next-intl renders a
// missing one as nothing, which would read "Also in plan: ".
const placeholders: Record<string, string> = {
  'siteRecovery.createPlan.vmInOtherPlans': '{plans}',
  'siteRecovery.plans.sharesGuestsWith': '{plans}',
  'siteRecovery.plans.alsoInPlan': '{plan}',
}

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('Recovery plan overlap i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every overlap and refresh key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} keeps the plan placeholder in every sentence that names one`, () => {
      for (const [key, placeholder] of Object.entries(placeholders)) {
        expect(get(messages, key) as string, `${locale}: ${key}`).toContain(placeholder)
      }
    })
  }
})
