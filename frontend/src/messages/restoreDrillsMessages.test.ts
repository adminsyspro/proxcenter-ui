import { describe, expect, it } from 'vitest'

import { DRILL_STAGE_KEYS, PREFLIGHT_CHECK_KEYS } from '@/lib/backups/restoreDrills/types'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

/** Every leaf of an object, as dotted paths. */
function leaves(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`])
}

const get = (obj: any, path: string) => path.split('.').reduce((o, k) => o?.[k], obj)

const PLACEHOLDERS: Record<string, string[]> = {
  dialogTitle: ['{name}'],
  free: ['{size}'],
  preflightOk: ['{vmid}', '{size}'],
  preflightError: ['{error}'],
  startError: ['{error}'],
  count: ['{count'],
  'result.failedAt': ['{stage}'],
  'detail.cleanupError': ['{error}'],
  'detail.tempGuestValue': ['{vmid}', '{name}'],
  'actions.error': ['{error}'],
  'settings.range': ['{min}', '{max}'],
  'settings.saveError': ['{error}'],
  'settings.loadError': ['{error}'],
  'screenshot.capturedAt': ['{time}'],
  'screenshot.unavailableReason': ['{reason}'],
  'schedules.count': ['{count'],
  'schedules.scopeVms': ['{count'],
  'schedules.scopeAll': ['{source}'],
  'schedules.recurrence.daily': ['{time}'],
  'schedules.recurrence.weekly': ['{days}', '{time}'],
  'schedules.recurrence.monthly': ['{day}', '{time}'],
  'schedules.deleteConfirm': ['{name}'],
  'schedules.filterChip': ['{name}'],
  'schedules.detail.rotationValue': ['{vmid}'],
  'schedules.detail.skippedVm': ['{vmid}', '{reason}'],
  'schedules.detail.runDrills': ['{count'],
  'schedules.form.titleEdit': ['{name}'],
  'schedules.form.saveError': ['{error}'],
}

const reference = leaves(en.backups.restoreDrills)

describe('Restore drills (roadmap#35) i18n parity across the 6 served locales', () => {
  it('names every preflight check, stage and stage status in English', () => {
    for (const key of PREFLIGHT_CHECK_KEYS) expect(reference).toContain(`checks.${key}`)
    for (const key of DRILL_STAGE_KEYS) expect(reference).toContain(`stages.${key}`)
    for (const key of DRILL_STAGE_KEYS) expect(reference).toContain(`steps.${key}`)
    for (const s of ['pending', 'running', 'ok', 'failed', 'skipped', 'not_assessed']) expect(reference).toContain(`stageStatus.${s}`)
    expect(en.backups.restoreDrills.stageStatus.not_assessed).toBe('Not assessed')
  })

  it('names the queue, the refusal, the origin and every schedule state in English', () => {
    expect(reference).toEqual(expect.arrayContaining(['status.queued', 'status.refused', 'result.refused', 'origin', 'originManual']))
    for (const r of ['ok', 'warning', 'failed', 'skipped', 'running']) expect(reference).toContain(`schedules.runResult.${r}`)
    for (const r of ['latest', 'latest_verified']) expect(reference).toContain(`schedules.restorePoint.${r}`)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of backups.restoreDrills`, () => {
      const drills = messages?.backups?.restoreDrills
      expect(drills, locale).toBeTypeOf('object')
      expect(leaves(drills).sort()).toEqual([...reference].sort())
      for (const path of reference) {
        const value = get(drills, path)
        expect(value, `${locale}: ${path}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ${path} is empty`).not.toBe('')
        expect(value, `${locale}: ${path} has an em-dash`).not.toContain('—')
      }
    })

    it(`${locale} keeps the placeholders`, () => {
      for (const [path, phs] of Object.entries(PLACEHOLDERS)) {
        const value = get(messages.backups.restoreDrills, path)
        for (const ph of phs) expect(value, `${locale}: ${path} needs ${ph}`).toContain(ph)
      }
    })

    it(`${locale} labels the licence feature`, () => {
      expect(messages?.settings?.featureLabels?.backup_restore_drills).toBeTypeOf('string')
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      expect(locales[locale].backups.restoreDrills.testRestore, locale).not.toBe(en.backups.restoreDrills.testRestore)
      expect(locales[locale].backups.restoreDrills.stageStatus.not_assessed, locale).not.toBe('Not assessed')
      expect(locales[locale].backups.restoreDrills.screenshot.caption, locale).not.toBe(en.backups.restoreDrills.screenshot.caption)
      expect(locales[locale].backups.restoreDrills.schedules.empty, locale).not.toBe(en.backups.restoreDrills.schedules.empty)
      expect(locales[locale].backups.restoreDrills.schedules.form.vmsPerRunHelp, locale).not.toBe(en.backups.restoreDrills.schedules.form.vmsPerRunHelp)
    }
  })
})
