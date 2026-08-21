import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'siteRecovery.failover.networkIsolation',
  'siteRecovery.failover.networkIsolationHelp',
  'siteRecovery.failover.networkConnected',
  'siteRecovery.failover.networkConnectedWarning',
  'siteRecovery.failover.screenshotDelayLabel',
  'siteRecovery.failover.screenshotDelayHelp',
  'siteRecovery.failover.screenshotDelayInvalid',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('DR test failover options i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every DR test option key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} keeps the {seconds} placeholder in screenshotDelayHelp`, () => {
      expect(get(messages, 'siteRecovery.failover.screenshotDelayHelp'), locale).toContain(
        '{seconds}',
      )
    })

    it(`${locale} keeps the {min} and {max} placeholders in screenshotDelayInvalid`, () => {
      const value = get(messages, 'siteRecovery.failover.screenshotDelayInvalid')

      expect(value, locale).toContain('{min}')
      expect(value, locale).toContain('{max}')
    })
  }
})
