import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'templates.deploy.target.storageQuotaRemaining',
  'templates.deploy.target.storageQuotaUnlimited',
  'templates.deploy.target.storageQuotaUnavailable',
  'templates.deploy.target.noWritableStorage',
  'templates.deploy.target.storagesLoadError',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('tenant deploy storage i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every tenant storage key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} keeps the {remaining} placeholder`, () => {
      expect(get(messages, 'templates.deploy.target.storageQuotaRemaining'), locale).toContain('{remaining}')
    })
  }
})
