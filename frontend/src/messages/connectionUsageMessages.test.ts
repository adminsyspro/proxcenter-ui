import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'settings.connectionUsage.checking',
  'settings.connectionUsage.intro',
  'settings.connectionUsage.apiTokensTitle',
  'settings.connectionUsage.apiTokensHint',
  'settings.connectionUsage.titles.tenantOwner',
  'settings.connectionUsage.titles.vdcs',
  'settings.connectionUsage.titles.pbsVdcs',
  'settings.connectionUsage.titles.replicationJobs',
  'settings.connectionUsage.titles.recoveryPlans',
  'settings.connectionUsage.titles.microseg',
  'settings.connectionUsage.titles.drsRules',
  'settings.connectionUsage.titles.migrations',
  'settings.connectionUsage.titles.vdcMoves',
  'settings.connectionUsage.titles.complianceProfiles',
  'settings.connectionUsage.titles.slaWindows',
  'settings.connectionUsage.titles.restoreDrillSchedules',
  'siteRecovery.orphan.connectionName',
  'siteRecovery.orphan.jobHint',
  'siteRecovery.orphan.planHint',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('Connection links and Site Recovery orphans (ui#1394) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every connection link and orphan key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })
  }
})
