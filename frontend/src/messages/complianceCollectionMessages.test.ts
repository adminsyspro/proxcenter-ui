import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The compliance collection settings (Policies tab) and the background report
// jobs (Frameworks tab, taskbar, toast). A missing key renders its own path,
// since request.ts has no English fallback.
const requiredKeys = [
  'compliance.collection.title',
  'compliance.collection.cacheMinutes',
  'compliance.collection.cacheMinutesHelper',
  'compliance.collection.cacheNever',
  'compliance.collection.cacheMinutesValue',
  'compliance.collection.guestConcurrency',
  'compliance.collection.guestConcurrencyHelper',
  'compliance.collection.invalid',
  'compliance.frameworks.reportQueued',
  'compliance.frameworks.reportTaskLabel',
  'compliance.frameworks.reportReady',
  'compliance.frameworks.reportDownload',
  'compliance.frameworks.reportExpired',
  'compliance.frameworks.reportFailed',
  'compliance.frameworks.tooManyReports',
  'compliance.frameworks.reportChip',
  'compliance.frameworks.reportDismiss',
]

// Placeholders the code fills in: a translation that drops one shows a gap.
const placeholders: Record<string, string[]> = {
  'compliance.collection.cacheMinutesValue': ['{minutes}'],
  'compliance.collection.guestConcurrencyHelper': ['{requests}'],
  'compliance.frameworks.reportQueued': ['{framework}'],
  'compliance.frameworks.reportTaskLabel': ['{framework}'],
  'compliance.frameworks.reportReady': ['{report}'],
}

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('compliance collection i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key, with its placeholders`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        for (const p of placeholders[key] ?? []) expect(value as string, `${locale}: ${key} lacks ${p}`).toContain(p)
      }
    })
  }
})
