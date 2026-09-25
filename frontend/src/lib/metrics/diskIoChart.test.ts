import { describe, expect, it } from 'vitest'

import { DISK_IO_COLORS, diskIoLegendSeries, hasIoPressureSeries } from './diskIoChart'

describe('diskIoLegendSeries', () => {
  it('lists the bandwidth areas then one latency entry per disk, cycling the line colours', () => {
    expect(diskIoLegendSeries(['scsi0', 'scsi1', 'virtio0'], { read: 'Read', write: 'Write' }, ['#a', '#b'])).toEqual([
      { key: 'diskReadBps', label: 'Read', color: DISK_IO_COLORS.read },
      { key: 'diskWriteBps', label: 'Write', color: DISK_IO_COLORS.write },
      { key: 'lat_scsi0', label: 'scsi0', color: '#a' },
      { key: 'lat_scsi1', label: 'scsi1', color: '#b' },
      { key: 'lat_virtio0', label: 'virtio0', color: '#a' },
    ])
  })

  it('keeps only the bandwidth entries without disks', () => {
    expect(diskIoLegendSeries([], { read: 'R', write: 'W' }, ['#a']).map(s => s.key)).toEqual(['diskReadBps', 'diskWriteBps'])
  })
})

describe('hasIoPressureSeries', () => {
  it('is true once a point carries the pressure, false for an older archive or no points', () => {
    expect(hasIoPressureSeries([{ psiIoSome: 0 }, {}])).toBe(true)
    expect(hasIoPressureSeries([{}, { psiIoSome: undefined }])).toBe(false)
    expect(hasIoPressureSeries([])).toBe(false)
  })
})
