import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PROGRESS_KEYS = [
  'awaitingApproval',
  'approvalBanner',
  'approveNode',
  'showUpdateOutput',
  'hideUpdateOutput',
  'pkgWaitingLock',
  'pkgDownloading',
  'pkgUnpacking',
  'pkgConfiguring',
  'pkgDone'
]

const PLACEHOLDERS_BY_KEY: Record<string, string> = {
  approvalBanner: '{node}',
  approveNode: '{node}',
  pkgWaitingLock: '{seconds}',
  pkgDownloading: '{count}',
  pkgUnpacking: '{count}',
  pkgConfiguring: '{count}',
  pkgDone: '{count}'
}

describe('rolling update progress messages, i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every rolling update progress message as a non-empty string`, () => {
      for (const key of PROGRESS_KEYS) {
        const value = messages?.updates?.[key]
        expect(value, `${locale}: updates.${key}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: updates.${key}`).not.toBe('')
      }
    })

    it(`${locale} preserves every rolling update progress placeholder`, () => {
      for (const [key, placeholder] of Object.entries(PLACEHOLDERS_BY_KEY)) {
        expect(messages?.updates?.[key], `${locale}: updates.${key}`).toContain(placeholder)
      }
    })
  }
})
