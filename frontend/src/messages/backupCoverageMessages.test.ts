import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const REASONS = ['no_job', 'not_selected', 'excluded', 'other_node', 'disabled_job']

const PLACEHOLDERS: Record<string, string[]> = {
  title: [],
  uncoveredCount: ['{count}'],
  allCoveredShort: [],
  coveredOf: ['{covered}', '{total}'],
  allCovered: [],
  noMatch: [],
  settings: [],
  search: [],
  allClusters: [],
  allReasons: [],
  colGuest: [],
  colCluster: [],
  colNode: [],
  colReason: [],
  detailJobs: [],
  detailPool: [],
  detailTags: [],
  detailCreated: [],
  detailUnknown: [],
  detailNone: [],
  ignoredTemplates: ['count'],
  ignoredTag: ['count', '{tag}'],
  ignoredGrace: ['count', '{hours}'],
  notListed: ['{items}'],
  errorsTitle: ['{clusters}'],
  loadError: [],
  displayedRows: ['{from}', '{to}', '{count}'],
  graceLabel: [],
  graceHelp: [],
  tagLabel: [],
  tagHelp: [],
  tagInvalid: [],
  saved: [],
  saveError: [],
  alertsLabel: [],
  alertsHelp: [],
  addToJob: [],
  addTitle: ['{name}', '{vmid}'],
  jobsLoadError: [],
  noJobOnCluster: ['{cluster}'],
  createJob: [],
  addWillUnexclude: [],
  addWillAppend: [],
  addDisabledWarning: [],
  addConfirm: [],
  addedToJob: ['{name}', '{job}'],
  addedToDisabledJob: ['{name}', '{job}'],
  addError: ['{error}'],
}

const REFUSALS: Record<string, string[]> = { pool: ['{pool}'], other_node: ['{node}'], already: [], no_selection: [] }

describe('Backup coverage (roadmap#48) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    const coverage = messages?.backups?.coverage

    for (const [key, placeholders] of Object.entries(PLACEHOLDERS)) {
      it(`${locale} declares backups.coverage.${key} with its placeholders`, () => {
        const value = coverage?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        for (const ph of placeholders) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
        expect(value, `${locale}: ${key} has an em-dash`).not.toContain('—')
      })
    }

    it(`${locale} explains every job the guest cannot be added to`, () => {
      for (const [r, phs] of Object.entries(REFUSALS)) {
        const value = coverage?.addRefused?.[r]
        expect(value, `${locale}: addRefused.${r}`).toBeTypeOf('string')
        for (const ph of phs) expect(value, `${locale}: addRefused.${r} needs ${ph}`).toContain(ph)
      }
    })

    it(`${locale} labels and explains every reason`, () => {
      for (const r of REASONS) {
        expect(coverage?.reasons?.[r], `${locale}: reasons.${r}`).toBeTypeOf('string')
        expect(coverage?.hints?.[r], `${locale}: hints.${r}`).toBeTypeOf('string')
      }
    })

    it(`${locale} names, describes and details the alert toggle of the thresholds tab`, () => {
      expect(messages?.alerts?.backupCoverage).toBeTypeOf('string')
      expect(messages?.alerts?.backupCoverageDesc).toBeTypeOf('string')
      expect(messages?.alerts?.backupCoverageDetail).toContain('{hours}')
      expect(messages?.alerts?.backupCoverageDetail).toContain('{tag}')
    })

    it(`${locale} explains that the PBS namespace belongs to the storage`, () => {
      expect(messages?.backups?.namespaceFromStorage).toBeTypeOf('string')
      expect(messages?.backups?.namespaceStorageMismatch).toContain('{storage}')
      expect(messages?.backups?.namespaceStorageMismatch).toContain('{namespace}')
      expect(messages?.backups?.noStorageForNamespace).toContain('{namespace}')
    })

    it(`${locale} names and describes the dashboard widget`, () => {
      expect(messages?.dashboard?.widgetNames?.backupCoverage).toBeTypeOf('string')
      expect(messages?.dashboard?.widgetDescs?.backupCoverage).toBeTypeOf('string')
      expect(messages?.dashboard?.widgetBackupCoverage?.uncovered).toBeTypeOf('string')
      expect(messages?.dashboard?.widgetBackupCoverage?.viewAll).toBeTypeOf('string')
    })
  }
})
