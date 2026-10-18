import { describe, expect, it } from 'vitest'

import { aggregateUsage, csvCell, periodEndOf, periodStartOf, usagePeriodsToCsv, type UsageSampleRow } from './aggregate'

function row(at: string, storageMb: number, extra: Partial<UsageSampleRow> = {}): UsageSampleRow {
  return {
    sampledAt: new Date(at),
    usedVcpus: 4,
    usedRamMb: 2048,
    usedStorageMb: storageMb,
    usedVms: 2,
    usedSnapshots: 0,
    usedBackups: 1,
    usedStorageByStorage: null,
    ...extra,
  }
}

describe('periodStartOf / periodEndOf (UTC periods)', () => {
  const d = new Date('2026-10-14T13:47:12.345Z')

  it('cuts hours, days and months in UTC', () => {
    expect(periodStartOf(d, 'hour').toISOString()).toBe('2026-10-14T13:00:00.000Z')
    expect(periodStartOf(d, 'day').toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(periodStartOf(d, 'month').toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(periodStartOf(d, 'sample').toISOString()).toBe(d.toISOString())
  })

  it('ends a period at the start of the next one, across month and year ends', () => {
    expect(periodEndOf(new Date('2026-10-14T13:00:00Z'), 'hour').toISOString()).toBe('2026-10-14T14:00:00.000Z')
    expect(periodEndOf(new Date('2026-10-31T00:00:00Z'), 'day').toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(periodEndOf(new Date('2026-12-01T00:00:00Z'), 'month').toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(periodEndOf(d, 'sample').toISOString()).toBe(d.toISOString())
  })
})

describe('aggregateUsage', () => {
  it('gives max, average and last value per counter and per period', () => {
    const periods = aggregateUsage(
      [
        row('2026-10-14T10:05:00Z', 1000),
        row('2026-10-14T10:20:00Z', 3000),
        row('2026-10-14T10:50:00Z', 2000, { usedVms: 3 }),
        row('2026-10-14T11:05:00Z', 500),
      ],
      'hour',
    )

    expect(periods).toHaveLength(2)
    expect(periods[0]).toMatchObject({
      periodStart: '2026-10-14T10:00:00.000Z',
      periodEnd: '2026-10-14T11:00:00.000Z',
      samples: 3,
    })
    expect(periods[0].counters.usedStorageMb).toEqual({ max: 3000, avg: 2000, last: 2000 })
    expect(periods[0].counters.usedVms).toEqual({ max: 3, avg: 2.33, last: 3 })
    expect(periods[1].counters.usedStorageMb).toEqual({ max: 500, avg: 500, last: 500 })
  })

  it('keeps one period per sample with the sample bucket, even for equal timestamps', () => {
    const periods = aggregateUsage([row('2026-10-14T10:05:00Z', 1), row('2026-10-14T10:05:00Z', 2)], 'sample')

    expect(periods.map(p => p.counters.usedStorageMb.last)).toEqual([1, 2])
    expect(periods.every(p => p.samples === 1)).toBe(true)
  })

  it('aggregates each storage over the samples that measured it, ignoring junk', () => {
    const periods = aggregateUsage(
      [
        row('2026-10-14T10:00:00Z', 0, { usedStorageByStorage: { ceph: 100, zfs: 10 } }),
        row('2026-10-14T10:10:00Z', 0, { usedStorageByStorage: { ceph: 300, bad: 'x' } }),
        row('2026-10-14T10:20:00Z', 0, { usedStorageByStorage: [1, 2] }),
      ],
      'day',
    )

    expect(periods[0].storages).toEqual({
      ceph: { max: 300, avg: 200, last: 300 },
      zfs: { max: 10, avg: 10, last: 10 },
    })
  })

  it('returns nothing for no samples', () => {
    expect(aggregateUsage([], 'month')).toEqual([])
  })
})

describe('usagePeriodsToCsv', () => {
  it('writes one line per period with every counter and storage column', () => {
    const periods = aggregateUsage(
      [
        row('2026-10-14T10:00:00Z', 1000, { usedStorageByStorage: { ceph: 100 } }),
        row('2026-10-15T10:00:00Z', 2000),
      ],
      'day',
    )
    const csv = usagePeriodsToCsv({ id: 'vdc-1', name: 'ACME, prod' }, periods)
    const lines = csv.trimEnd().split('\r\n')

    expect(lines).toHaveLength(3)
    const header = lines[0].split(',')

    expect(header.slice(0, 8)).toEqual(['vdc_id', 'vdc_name', 'period_start', 'period_end', 'samples', 'vcpus_max', 'vcpus_avg', 'vcpus_last'])
    expect(header).toContain('storage_mb_last')
    expect(header.slice(-3)).toEqual(['storage_ceph_mb_max', 'storage_ceph_mb_avg', 'storage_ceph_mb_last'])
    expect(lines[1].startsWith('vdc-1,"ACME, prod",2026-10-14T00:00:00.000Z,2026-10-15T00:00:00.000Z,1,')).toBe(true)
    expect(lines[1].endsWith(',100,100,100')).toBe(true)
    // A storage absent from a period leaves its cells empty, not zero.
    expect(lines[2].endsWith(',,,')).toBe(true)
  })

  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell(-1)).toBe('-1')
    expect(csvCell('plain')).toBe('plain')
  })
})
