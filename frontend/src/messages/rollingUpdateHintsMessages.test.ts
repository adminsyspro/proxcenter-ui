import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// One tooltip per parameter of the rolling update Configuration step.
const HINT_KEYS = [
  'migrateNonHaVmsHint',
  'autoRebootHint',
  'setCephNooutHint',
  'abortOnFailureHint',
  'manualApprovalHint',
  'maxParallelMigrationsHint',
  'migrationTimeoutHint',
  'rebootTimeoutHint',
  'minHealthyNodesHint',
  'shutdownLocalVmsRollingHint',
  'waitCephHealthyHint'
]

describe('rolling update parameter tooltips, i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every updates.*Hint used by RollingUpdateWizard`, () => {
      for (const key of HINT_KEYS) {
        const value = messages?.updates?.[key]
        expect(value, `${locale}: updates.${key}`).toBeTypeOf('string')
        expect(value.length, `${locale}: updates.${key} is too short to explain anything`).toBeGreaterThan(40)
      }
    })

    it(`${locale} keeps the single-node dialog's shutdownLocalVmsHint distinct from the rolling one`, () => {
      expect(messages?.updates?.shutdownLocalVmsHint).toBeTypeOf('string')
      expect(messages.updates.shutdownLocalVmsHint).not.toBe(messages.updates.shutdownLocalVmsRollingHint)
    })
  }
})

const ESTIMATE_KEYS = [
  'estimateBreakdownTitle',
  'estimateColFixed',
  'estimateColPackages',
  'estimateColMigrations',
  'estimateColReboot',
  'estimateColTotal',
  'estimateBreakdownNote'
]

describe('rolling update time estimate breakdown tooltip, i18n parity', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every estimate label and the note quotes the 16 fixed minutes`, () => {
      for (const key of ESTIMATE_KEYS) {
        expect(messages?.updates?.[key], `${locale}: updates.${key}`).toBeTypeOf('string')
      }
      expect(messages.updates.estimateBreakdownNote).toContain('16')
    })
  }
})
