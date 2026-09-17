import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The cleanup of a test failover runs for minutes on large replica images
// (ui#958), so the dialog reports it guest by guest. A locale missing one of
// these keys shows the operator the raw key path: de.json has no English
// fallback of any kind.
const requiredKeys = [
  'siteRecovery.failover.cleanupRunning',
  'siteRecovery.failover.cleanupProgress',
  'siteRecovery.failover.cleanupGuestCleaned',
  'siteRecovery.failover.cleanupGuestCleaning',
  'siteRecovery.failover.cleanupGuestPending',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('Test failover cleanup progress i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every cleanup progress key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    // Both placeholders must survive translation: next-intl renders a missing
    // one as nothing, which would read "1 of  guests cleaned up".
    it(`${locale} keeps both counters in the progress sentence`, () => {
      const progress = get(messages, 'siteRecovery.failover.cleanupProgress') as string

      expect(progress, `${locale}: {cleaned}`).toContain('{cleaned}')
      expect(progress, `${locale}: {total}`).toContain('{total}')
    })
  }
})
