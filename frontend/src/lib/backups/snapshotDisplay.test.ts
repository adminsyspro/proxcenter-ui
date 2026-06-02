import { describe, it, expect } from 'vitest'

import { buildPbsSnapshotName, pbsFormatLabel } from './snapshotDisplay'

describe('buildPbsSnapshotName', () => {
  it('builds the PVE-style name with a UTC timestamp (no milliseconds)', () => {
    // 2026-06-01T20:24:43Z — the same snapshot id native PVE shows.
    const epoch = Date.UTC(2026, 5, 1, 20, 24, 43) / 1000
    expect(buildPbsSnapshotName('ct', '100', epoch)).toBe('ct/100/2026-06-01T20:24:43Z')
  })

  it('keeps the UTC stamp regardless of the host/runtime timezone', () => {
    const epoch = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000
    expect(buildPbsSnapshotName('vm', 269, epoch)).toBe('vm/269/2026-01-02T03:04:05Z')
  })

  it('returns an empty string for incomplete input', () => {
    expect(buildPbsSnapshotName('', '100', 1000)).toBe('')
    expect(buildPbsSnapshotName('ct', '', 1000)).toBe('')
    expect(buildPbsSnapshotName('ct', '100', 0)).toBe('')
  })
})

describe('pbsFormatLabel', () => {
  it('prefixes the backup type with pbs-', () => {
    expect(pbsFormatLabel('ct')).toBe('pbs-ct')
    expect(pbsFormatLabel('vm')).toBe('pbs-vm')
    expect(pbsFormatLabel('host')).toBe('pbs-host')
  })

  it('returns an empty string when the type is missing', () => {
    expect(pbsFormatLabel('')).toBe('')
  })
})
