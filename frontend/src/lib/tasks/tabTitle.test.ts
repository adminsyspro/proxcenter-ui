import { describe, it, expect } from 'vitest'

import { buildTabAlertTitle, buildTabTitle, undecorateTabTitle } from './tabTitle'

const task = (typeLabel: string, entity: string | null = null) => ({ typeLabel, entity })

describe('buildTabTitle', () => {
  it('leaves the base title alone when nothing is running', () => {
    expect(buildTabTitle([], 'PROXCENTER', 'running')).toBe('PROXCENTER')
  })

  it('names the job, with its entity, when exactly one is running', () => {
    expect(buildTabTitle([task('Shell Console', 'pve1')], 'PROXCENTER', 'running')).toBe(
      '⏳ Shell Console (pve1) · PROXCENTER'
    )
  })

  it('names the job without parentheses when it carries no entity', () => {
    expect(buildTabTitle([task('Backup')], 'PROXCENTER', 'running')).toBe('⏳ Backup · PROXCENTER')
  })

  // The reported bug: PVE keeps a shell task open for as long as its console
  // is, so three open shells used to read "vncshell • vncshell • vncshell".
  it('counts instead of listing once more than one job is running', () => {
    const shells = [task('Shell Console', 'pve1'), task('Shell Console', 'pve2'), task('Shell Console', 'pve3')]

    expect(buildTabTitle(shells, 'PROXCENTER', 'running')).toBe('⏳ 3 running · PROXCENTER')
  })

  it('keeps the white-label base title rather than the product name', () => {
    expect(buildTabTitle([task('Backup')], 'MSP Cloud', 'en cours')).toBe('⏳ Backup · MSP Cloud')
    expect(buildTabTitle([task('Backup'), task('Backup')], 'MSP Cloud', 'en cours')).toBe('⏳ 2 en cours · MSP Cloud')
  })
})

describe('buildTabAlertTitle', () => {
  it('carries the same marker-separator-base shape as a running title', () => {
    expect(buildTabAlertTitle('New task: Backup', 'MSP Cloud')).toBe('🔔 New task: Backup · MSP Cloud')
  })
})

describe('undecorateTabTitle', () => {
  it('returns an undecorated title untouched', () => {
    expect(undecorateTabTitle('PROXCENTER')).toBe('PROXCENTER')
  })

  it('leaves a title that has a separator but no marker alone', () => {
    expect(undecorateTabTitle('Acme · Cloud')).toBe('Acme · Cloud')
  })

  it('leaves a title that has a marker but no separator alone', () => {
    expect(undecorateTabTitle('⏳ nothing to strip')).toBe('⏳ nothing to strip')
  })

  it('strips a running decoration back to the base title', () => {
    expect(undecorateTabTitle('⏳ 3 running · PROXCENTER')).toBe('PROXCENTER')
  })

  it('strips an alert decoration back to the base title', () => {
    expect(undecorateTabTitle('🔔 New task: Backup · MSP Cloud')).toBe('MSP Cloud')
  })

  // A base title may hold a separator of its own; only the first one delimits
  // the decoration.
  it('keeps the separators that belong to the base title', () => {
    expect(undecorateTabTitle('⏳ 2 running · Acme · Cloud')).toBe('Acme · Cloud')
  })

  // Round trip: what buildTabTitle assembles, undecorateTabTitle takes apart.
  it('undoes what buildTabTitle built', () => {
    for (const tasks of [[task('Backup', 'vm/101')], [task('Backup'), task('Restore')]]) {
      expect(undecorateTabTitle(buildTabTitle(tasks, 'MSP Cloud', 'running'))).toBe('MSP Cloud')
    }
  })
})
