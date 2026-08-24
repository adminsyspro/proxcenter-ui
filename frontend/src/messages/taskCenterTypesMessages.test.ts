import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Every type the Task Center can display. typeSiteRecovery replaced the
// misleading "Maintenance" chip on failover/failback/test-failover rows.
const requiredKeys = [
  'jobsPage.typeRollingUpdate',
  'jobsPage.typeReplication',
  'jobsPage.typeDrs',
  'jobsPage.typeMigration',
  'jobsPage.typeSiteRecovery',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('Task Center job-type i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every job-type key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })
  }
})
