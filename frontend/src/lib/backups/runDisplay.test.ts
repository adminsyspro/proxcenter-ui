import { describe, it, expect } from 'vitest'

import { formatDurationSec, guestStatusChip, isProgressLine, logLineKind, runStatusChip } from './runDisplay'

describe('runStatusChip', () => {
  it('maps every run status to a colour and a message key', () => {
    expect(runStatusChip({ status: 'ok', statusDetail: { failed: 0, total: 3 } })).toEqual({ color: 'success', key: 'backups.runs.status.ok', count: null })
    expect(runStatusChip({ status: 'warning', statusDetail: { failed: 0, total: 1 } }).color).toBe('warning')
    expect(runStatusChip({ status: 'running', statusDetail: { failed: 0, total: 1 } }).color).toBe('info')
    expect(runStatusChip({ status: 'failed', statusDetail: { failed: 2, total: 2 } })).toEqual({ color: 'error', key: 'backups.runs.status.failed', count: null })
  })

  it('names the failed step and counts it when several guests ran', () => {
    expect(runStatusChip({ status: 'post_step_failed', statusDetail: { failed: 1, total: 5, step: 'prune' } }))
      .toEqual({ color: 'warning', key: 'backups.runs.status.post.prune', count: '1/5' })
    expect(runStatusChip({ status: 'post_step_failed', statusDetail: { failed: 1, total: 1 } }))
      .toEqual({ color: 'warning', key: 'backups.runs.status.post.other', count: null })
  })

  it('counts a partial run', () => {
    expect(runStatusChip({ status: 'partial', statusDetail: { failed: 2, total: 5 } }))
      .toEqual({ color: 'error', key: 'backups.runs.status.partial', count: '2/5' })
  })
})

describe('guestStatusChip', () => {
  it('reuses the run keys for a guest', () => {
    expect(guestStatusChip({ status: 'post_step_failed', step: 'prune' }).key).toBe('backups.runs.status.post.prune')
    expect(guestStatusChip({ status: 'ok_warnings', step: null })).toEqual({ color: 'warning', key: 'backups.runs.status.warning', count: null })
    expect(guestStatusChip({ status: 'failed', step: null }).color).toBe('error')
    expect(guestStatusChip({ status: 'ok', step: null })).toEqual({ color: 'success', key: 'backups.runs.status.ok', count: null })
    expect(guestStatusChip({ status: 'running', step: null })).toEqual(expect.objectContaining({ color: 'info', key: 'backups.runs.status.running' }))
  })
})

describe('formatDurationSec', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDurationSec(45)).toBe('45s')
    expect(formatDurationSec(843)).toBe('14m 03s')
    expect(formatDurationSec(7500)).toBe('2h 05m')
    expect(formatDurationSec(null)).toBe('—')
  })
})

describe('log lines', () => {
  it('classifies by prefix only (a guest named "error-vm" is not an error)', () => {
    expect(logLineKind("ERROR: prune 'vm/103': failed")).toBe('error')
    expect(logLineKind('TASK ERROR: job errors')).toBe('error')
    expect(logLineKind('WARN: agent not running')).toBe('warning')
    expect(logLineKind('INFO: VM Name: error-vm')).toBe('info')
  })

  it('recognises progress lines', () => {
    expect(isProgressLine('INFO:  12% (2.4 GiB of 20.0 GiB) in 1m 19s, read: 24.5 MiB/s')).toBe(true)
    expect(isProgressLine('INFO: transferred 20.00 GiB in 145 seconds')).toBe(false)
  })
})
