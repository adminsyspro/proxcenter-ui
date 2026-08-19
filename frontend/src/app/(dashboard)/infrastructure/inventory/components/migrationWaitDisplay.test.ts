/**
 * Unit tests for the migration wait display rules.
 *
 * Three operator gates can park a run (warm cutover #443, forced power off
 * #614, root filesystem choice #738) and two surfaces render them: these tests
 * pin the precedence between the gates, the terminal statuses, and the raw
 * step fallbacks that the extraction moved out of the JSX ternary chains.
 */

import { describe, it, expect } from 'vitest'

import {
  waitKind,
  statusChipLabelKey,
  waitIconClass,
  waitTitleKey,
  isWaitDisplayKey,
} from './migrationWaitDisplay'

// One representative job per gate, shaped like the API's migration job.
const powerOffWait = { id: 'j1', status: 'cutover', currentStep: 'awaiting_power_off' }
const rootChoiceWait = { id: 'j2', status: 'converting_disks', currentStep: 'awaiting_root_choice' }
const cutoverGate = { id: 'j3', status: 'awaiting_cutover', currentStep: 'delta_sync' }
const manualHold = { id: 'j4', status: 'delta_sync', currentStep: 'delta_sync', config: { cutoverMode: 'manual' } }
const running = { id: 'j5', status: 'full_copy', currentStep: 'copying_disk_1' }

describe('waitKind', () => {
  it('names each gate', () => {
    expect(waitKind(powerOffWait)).toBe('powerOff')
    expect(waitKind(rootChoiceWait)).toBe('rootChoice')
    expect(waitKind(cutoverGate)).toBe('cutover')
  })

  it('reads a manual hold as the cutover wait even though the status is delta_sync', () => {
    expect(waitKind(manualHold)).toBe('cutover')
  })

  it('ranks the shutdown refusal, then the root choice, above the cutover gate', () => {
    // A single job can satisfy two predicates; the chip must name the wait
    // the operator has to resolve first.
    expect(waitKind({ id: 'j6', status: 'awaiting_cutover', currentStep: 'awaiting_power_off' })).toBe('powerOff')
    expect(waitKind({ id: 'j7', status: 'awaiting_cutover', currentStep: 'awaiting_root_choice' })).toBe('rootChoice')
  })

  it('is null for a job that is simply running', () => {
    expect(waitKind(running)).toBe(null)
  })

  it('is null once the job is terminal, whatever step it died on', () => {
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(waitKind({ id: 'j8', status, currentStep: 'awaiting_power_off' })).toBe(null)
      expect(waitKind({ id: 'j8', status, currentStep: 'awaiting_root_choice' })).toBe(null)
    }
  })

  it('is null for a missing job', () => {
    expect(waitKind(null)).toBe(null)
    expect(waitKind(undefined)).toBe(null)
  })
})

describe('statusChipLabelKey (panel)', () => {
  it('gives the terminal statuses their own labels', () => {
    expect(statusChipLabelKey({ id: 'j', status: 'completed' })).toBe('inventoryPage.esxiMigration.completed')
    expect(statusChipLabelKey({ id: 'j', status: 'failed' })).toBe('inventoryPage.esxiMigration.failed')
    expect(statusChipLabelKey({ id: 'j', status: 'cancelled' })).toBe('inventoryPage.esxiMigration.cancelled')
  })

  it('lets a terminal status win over a leftover wait step', () => {
    expect(statusChipLabelKey({ id: 'j', status: 'completed', currentStep: 'awaiting_power_off' }))
      .toBe('inventoryPage.esxiMigration.completed')
  })

  it('labels each wait, in gate order', () => {
    expect(statusChipLabelKey(powerOffWait)).toBe('inventoryPage.esxiMigration.awaitingPowerOff')
    expect(statusChipLabelKey(rootChoiceWait)).toBe('inventoryPage.esxiMigration.awaitingRootChoice')
    expect(statusChipLabelKey(cutoverGate)).toBe('inventoryPage.esxiMigration.awaitingCutover')
    expect(statusChipLabelKey(manualHold)).toBe('inventoryPage.esxiMigration.awaitingCutover')
  })

  it('lets a wait win over the preparing_disks label', () => {
    expect(statusChipLabelKey({ id: 'j', status: 'preparing_disks', currentStep: 'awaiting_power_off' }))
      .toBe('inventoryPage.esxiMigration.awaitingPowerOff')
  })

  it('labels preparing_disks when nothing waits', () => {
    expect(statusChipLabelKey({ id: 'j', status: 'preparing_disks', currentStep: '' }))
      .toBe('inventoryPage.esxiMigration.preparingDisks')
  })

  it('falls back to the step with underscores replaced', () => {
    expect(statusChipLabelKey(running)).toBe('copying disk 1')
  })

  it('formats the bare status when the step is empty', () => {
    expect(statusChipLabelKey({ id: 'j', status: 'delta_sync', currentStep: '' })).toBe('delta sync')
  })

  it('is empty for a missing job', () => {
    expect(statusChipLabelKey(null)).toBe('')
    expect(statusChipLabelKey(undefined)).toBe('')
  })
})

describe('statusChipLabelKey (dialog)', () => {
  it('labels the waits exactly like the panel', () => {
    expect(statusChipLabelKey(powerOffWait, 'dialog')).toBe('inventoryPage.esxiMigration.awaitingPowerOff')
    expect(statusChipLabelKey(rootChoiceWait, 'dialog')).toBe('inventoryPage.esxiMigration.awaitingRootChoice')
    expect(statusChipLabelKey(cutoverGate, 'dialog')).toBe('inventoryPage.esxiMigration.awaitingCutover')
  })

  it('keeps the dialog quirks: raw status untouched, no preparing_disks label', () => {
    // Historical behaviour of the migrate dialog chip, preserved on purpose:
    // it never underscore-formatted the bare status and never translated
    // preparing_disks. The step, when present, is still formatted.
    expect(statusChipLabelKey({ id: 'j', status: 'delta_sync', currentStep: '' }, 'dialog')).toBe('delta_sync')
    expect(statusChipLabelKey({ id: 'j', status: 'preparing_disks', currentStep: '' }, 'dialog')).toBe('preparing_disks')
    expect(statusChipLabelKey(running, 'dialog')).toBe('copying disk 1')
  })

  it('is empty for a missing job', () => {
    expect(statusChipLabelKey(null, 'dialog')).toBe('')
  })
})

describe('waitIconClass', () => {
  it('gives each wait its icon and the plain run a spinner', () => {
    expect(waitIconClass(powerOffWait)).toBe('ri-shut-down-line')
    expect(waitIconClass(rootChoiceWait)).toBe('ri-list-check-2')
    expect(waitIconClass(cutoverGate)).toBe('ri-pause-circle-line')
    expect(waitIconClass(manualHold)).toBe('ri-pause-circle-line')
    expect(waitIconClass(running)).toBe('ri-loader-4-line')
    expect(waitIconClass(null)).toBe('ri-loader-4-line')
  })
})

describe('waitTitleKey', () => {
  it('titles the block after the wait', () => {
    expect(waitTitleKey(powerOffWait)).toBe('inventoryPage.esxiMigration.awaitingPowerOff')
    expect(waitTitleKey(rootChoiceWait)).toBe('inventoryPage.esxiMigration.awaitingRootChoice')
    expect(waitTitleKey(cutoverGate)).toBe('inventoryPage.esxiMigration.awaitingCutover')
  })

  it('falls back to the formatted step, then the formatted status', () => {
    expect(waitTitleKey(running)).toBe('copying disk 1')
    expect(waitTitleKey({ id: 'j', status: 'delta_sync', currentStep: '' })).toBe('delta sync')
    expect(waitTitleKey(null)).toBe('')
  })
})

describe('isWaitDisplayKey', () => {
  it('recognises every key the module can return and nothing else', () => {
    expect(isWaitDisplayKey(statusChipLabelKey(powerOffWait))).toBe(true)
    expect(isWaitDisplayKey(statusChipLabelKey({ id: 'j', status: 'completed' }))).toBe(true)
    expect(isWaitDisplayKey('inventoryPage.esxiMigration.preparingDisks')).toBe(true)
    // Raw step text must pass through untranslated.
    expect(isWaitDisplayKey('copying disk 1')).toBe(false)
    expect(isWaitDisplayKey('delta_sync')).toBe(false)
    expect(isWaitDisplayKey('')).toBe(false)
  })
})
