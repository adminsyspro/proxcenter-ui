import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'settings.siteRecovery',
  'settings.siteRecoveryInfo',
  'settings.replicationNetwork',
  'settings.replicationNetworkHelper',
  'settings.replicationNetworkNeedsSsh',
  'settings.errorReplicationNetworkInvalid',
  'siteRecovery.createJob.sshRequirementReplicationNetwork',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('connection replication network i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every replication network key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} keeps the CIDR example in the error message`, () => {
      expect(get(messages, 'settings.errorReplicationNetworkInvalid'), locale).toContain('10.10.50.0/24')
    })
  }
})
