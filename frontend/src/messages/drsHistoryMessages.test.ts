import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const plainKeys = [
  'history',
  'noRecentMigrations',
  'historyDisplayedRows',
  'historyTotal',
  'historyCompleted',
  'historyFailed',
  'historyAvgDuration',
  'historyAllClusters',
  'historyStatusLabel',
  'historyStatusAll',
  'historyStatusCompleted',
  'historyStatusFailed',
  'historyStatusRunning',
  'historySearch',
  'historyNoMatch',
  'historyEmptyDesc',
  'historyNoReason',
  'historyUnknownDate',
  'historyUnitSeconds',
  'historyUnitMinutes',
  'historyUnitHours'
]

describe('DRS history tab i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of plainKeys) {
      it(`${locale} declares drsPage.${key}`, () => {
        const value = messages?.drsPage?.[key]

        expect(value, `${locale}: drsPage.${key}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: drsPage.${key} must not be empty`).toBeGreaterThan(0)
      })
    }
  }
})
