import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'backups.bulkRestore.button',
  'backups.bulkRestore.title',
  'backups.bulkRestore.steps.guests',
  'backups.bulkRestore.steps.target',
  'backups.bulkRestore.steps.review',
  'backups.bulkRestore.restorePoint',
  'backups.bulkRestore.latest',
  'backups.bulkRestore.pointsCount',
  'backups.bulkRestore.guestGone',
  'backups.bulkRestore.selectedCount',
  'backups.bulkRestore.vmidFrom',
  'backups.bulkRestore.vmidTo',
  'backups.bulkRestore.vmidPolicy',
  'backups.bulkRestore.sectionDestination',
  'backups.bulkRestore.sectionVmid',
  'backups.bulkRestore.sectionOptions',
  'backups.bulkRestore.sourceHelp',
  'backups.bulkRestore.bandwidthHelp',
  'backups.bulkRestore.modeRange',
  'backups.bulkRestore.modeSource',
  'backups.bulkRestore.rangeStart',
  'backups.bulkRestore.rangeEnd',
  'backups.bulkRestore.rangeHelp',
  'backups.bulkRestore.rangeInvalid',
  'backups.bulkRestore.rangeExhausted',
  'backups.bulkRestore.targetExists',
  'backups.bulkRestore.overwrite',
  'backups.bulkRestore.overwriteWarning',
  'backups.bulkRestore.overwriteConfirmed',
  'backups.bulkRestore.uniqueMac',
  'backups.bulkRestore.startAfter',
  'backups.bulkRestore.nameSuffix',
  'backups.bulkRestore.nameSuffixHelp',
  'backups.bulkRestore.storageFromBackup',
  'backups.bulkRestore.concurrency',
  'backups.bulkRestore.targetVmid',
  'backups.bulkRestore.queueWarning',
  'backups.bulkRestore.runFinished',
  'backups.bulkRestore.startRestores',
  'backups.bulkRestore.stopRemaining',
  'backups.bulkRestore.jobsActive',
  'backups.bulkRestore.jobsDone',
  'backups.bulkRestore.jobsFailed',
  'backups.bulkRestore.jobsPending',
  'backups.bulkRestore.closeWhileRunning',
  'backups.bulkRestore.closeAnyway',
  'backups.bulkRestore.status.pending',
  'backups.bulkRestore.status.starting',
  'backups.bulkRestore.status.running',
  'backups.bulkRestore.status.done',
  'backups.bulkRestore.status.failed',
  'backups.bulkRestore.status.cancelled',
  'backups.bulkRestore.issue.targetExists',
  'backups.bulkRestore.issue.rangeExhausted',
  'backups.bulkRestore.issue.rangeInvalid',
]

/** ICU placeholders each parameterised message must carry. */
const placeholders: Record<string, string[]> = {
  'backups.bulkRestore.selectedCount': ['count'],
  'backups.bulkRestore.rangeExhausted': ['count'],
  'backups.bulkRestore.targetExists': ['count'],
  'backups.bulkRestore.overwriteWarning': ['count'],
  'backups.bulkRestore.startRestores': ['count'],
  'backups.bulkRestore.stopRemaining': ['count'],
  'backups.bulkRestore.jobsActive': ['count'],
  'backups.bulkRestore.jobsDone': ['count'],
  'backups.bulkRestore.jobsFailed': ['count'],
  'backups.bulkRestore.jobsPending': ['count'],
  'backups.bulkRestore.runFinished': ['done', 'failed'],
}

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('bulk restore i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every bulk restore key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    // A message is ICU: a placeholder dropped in translation renders the
    // literal text with no value, and a stray brace throws at render time.
    it(`${locale} keeps every placeholder and balances its braces`, () => {
      for (const [key, names] of Object.entries(placeholders)) {
        const value = get(messages, key) as string
        for (const name of names) {
          // `{count}` or the ICU plural form `{count, plural, ...}`.
          expect(value, `${locale}: ${key} must interpolate ${name}`).toMatch(new RegExp(`\\{${name}[,}]`))
        }
      }
      for (const key of requiredKeys) {
        const value = get(messages, key) as string
        const opens = (value.match(/\{/g) || []).length
        const closes = (value.match(/\}/g) || []).length
        expect(opens, `${locale}: ${key} has unbalanced braces`).toBe(closes)
      }
    })
  }
})
