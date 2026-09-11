import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales = { en, fr, de, es, ko, 'zh-CN': zhCN }

const CHANGES_CSV_KEYS = [
  'csvDate',
  'csvResourceType',
  'csvResourceId',
  'csvResourceName',
  'csvAction',
  'csvUser',
  'csvNode',
  'csvConnection',
  'csvFieldCount',
  'csvDetails',
] as const

const DASHBOARD_TRANSFER_KEYS = [
  'exportDashboards',
  'importDashboards',
  'dashboardsExported',
  'dashboardsImported',
  'importSkipped',
  'importDropped',
  'importReset',
  'exportFailed',
  'importedSuffix',
] as const

/** Every rejection parseDashboardFile can return needs a sentence in every locale. */
const IMPORT_ERROR_KEYS = [
  'invalid-json',
  'not-a-dashboard',
  'unsupported-version',
  'no-widgets',
  'not-stored',
] as const

function expectStrings(block: unknown, keys: readonly string[], locale: string, label: string) {
  const record = block as Record<string, unknown>

  expect(record, `${locale}: missing ${label} block`).toBeTypeOf('object')

  for (const key of keys) {
    expect(record, `${locale}: missing ${label}.${key}`).toHaveProperty(key)
    expect(record[key], `${locale}: ${label}.${key}`).toBeTypeOf('string')
    expect((record[key] as string).trim().length, `${locale}: ${label}.${key} is empty`).toBeGreaterThan(0)
  }
}

describe('export i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} names every change tracking CSV column`, () => {
      expectStrings(messages.changes, CHANGES_CSV_KEYS, locale, 'changes')
    })

    it(`${locale} names the dashboard transfer actions and their outcomes`, () => {
      expectStrings(messages.dashboard, DASHBOARD_TRANSFER_KEYS, locale, 'dashboard')
    })

    it(`${locale} explains every reason an import can be refused`, () => {
      const dashboard = messages.dashboard as Record<string, unknown>

      expectStrings(dashboard.importError, IMPORT_ERROR_KEYS, locale, 'dashboard.importError')
    })

    it(`${locale} keeps the placeholders the code passes`, () => {
      const dashboard = messages.dashboard as unknown as Record<string, string>

      // ICU plurals spell it `{count, plural, ...}`, so match the placeholder name.
      const counted = [
        'dashboardsExported',
        'dashboardsImported',
        'importSkipped',
        'importDropped',
        'importReset',
      ]

      for (const key of counted) {
        expect(dashboard[key], `${locale}: ${key}`).toMatch(/\{count[,}]/)
      }
    })
  }
})
