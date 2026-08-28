import { describe, expect, it } from 'vitest'

import {
  isAwaitingApproval,
  nodeStepFraction,
  packageFraction,
  packageProgressLabel,
  runProgressPercent,
  shouldExpandOutput
} from './updateProgress'

describe('nodeStepFraction', () => {
  it.each([
    ['pending', 0],
    ['entering_maintenance', 1 / 8],
    ['updating', 3 / 8],
    ['completed', 1],
    ['skipped', 1],
    ['failed', 1],
    ['unknown', 0]
  ])('returns the expected fraction for %s', (status, expected) => {
    expect(nodeStepFraction({ status })).toBe(expected)
  })

  it('includes package progress while a node is updating', () => {
    const fraction = nodeStepFraction({
      status: 'updating',
      package_progress: { phase: 'configure', done: 56, total: 245 }
    })

    expect(fraction).toBeGreaterThan(3 / 8)
    expect(fraction).toBeLessThan(4 / 8)
  })
})

describe('packageFraction', () => {
  it('returns zero without progress or while waiting for the apt lock', () => {
    expect(packageFraction()).toBe(0)
    expect(packageFraction({ phase: 'waiting_lock', done: 12, total: 0 })).toBe(0)
  })

  it('positions progress within each counted package phase', () => {
    expect(packageFraction({ phase: 'download', done: 1, total: 2 })).toBe(1 / 6)
    expect(packageFraction({ phase: 'unpack', done: 1, total: 2 })).toBe(1 / 2)
    expect(packageFraction({ phase: 'configure', done: 1, total: 2 })).toBe(5 / 6)
  })

  it('returns one for the done phase', () => {
    expect(packageFraction({ phase: 'done', done: 245, total: 245 })).toBe(1)
  })

  it('uses the phase start when total is zero', () => {
    expect(packageFraction({ phase: 'download', done: 56, total: 0 })).toBe(0)
    expect(packageFraction({ phase: 'unpack', done: 56, total: 0 })).toBe(1 / 3)
    expect(packageFraction({ phase: 'configure', done: 56, total: 0 })).toBe(2 / 3)
  })
})

describe('runProgressPercent', () => {
  it('returns zero when there are no nodes', () => {
    expect(runProgressPercent({ total_nodes: 0, completed_nodes: 0 })).toBe(0)
  })

  it('falls back to completed nodes when node statuses are missing', () => {
    expect(runProgressPercent({ total_nodes: 4, completed_nodes: 1 })).toBe(25)
  })

  it('sums the individual node fractions when statuses are available', () => {
    const percent = runProgressPercent({
      total_nodes: 3,
      completed_nodes: 1,
      node_statuses: [
        { status: 'completed' },
        { status: 'updating' },
        { status: 'pending' }
      ]
    })

    expect(percent).toBeCloseTo(100 * (1 + 0.375) / 3)
  })

  it('clamps progress to 100 when more statuses are returned than total nodes', () => {
    expect(runProgressPercent({
      total_nodes: 1,
      completed_nodes: 1,
      node_statuses: [{ status: 'completed' }, { status: 'completed' }]
    })).toBe(100)
  })
})

describe('packageProgressLabel', () => {
  it('returns null without progress', () => {
    expect(packageProgressLabel()).toBeNull()
  })

  it.each([
    ['waiting_lock', 'updates.pkgWaitingLock', { seconds: 56 }],
    ['download', 'updates.pkgDownloading', { count: '56/245' }],
    ['unpack', 'updates.pkgUnpacking', { count: '56/245' }],
    ['configure', 'updates.pkgConfiguring', { count: '56/245' }],
    ['done', 'updates.pkgDone', { count: 56 }]
  ])('maps %s to its translation key and values', (phase, key, values) => {
    expect(packageProgressLabel({ phase, done: 56, total: 245 })).toEqual({ key, values })
  })

  it('formats the count without a denominator when total is zero', () => {
    expect(packageProgressLabel({ phase: 'configure', done: 56, total: 0 })).toEqual({
      key: 'updates.pkgConfiguring',
      values: { count: '56' }
    })
  })
})

describe('isAwaitingApproval', () => {
  it.each([
    [{ status: 'paused', pending_approval: 'pve2' }, true],
    [{ status: 'paused', pending_approval: '' }, false],
    [{ status: 'paused' }, false],
    [{ status: 'running', pending_approval: 'pve2' }, false]
  ])('returns $expected for $0', (run, expected) => {
    expect(isAwaitingApproval(run)).toBe(expected)
  })
})

describe('shouldExpandOutput', () => {
  it.each([
    [{ status: 'failed', update_output: 'apt failed' }, true],
    [{ status: 'failed', update_output: '' }, false],
    [{ status: 'failed' }, false],
    [{ status: 'completed', update_output: 'apt output' }, false]
  ])('returns $expected for $0', (node, expected) => {
    expect(shouldExpandOutput(node)).toBe(expected)
  })
})
