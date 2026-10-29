import { describe, it, expect } from 'vitest'

import { nextRunDate } from './BackupJobsPanel'

describe('nextRunDate', () => {
  const now = new Date(2026, 9, 29, 12, 0, 0)

  it('uses the next-run Proxmox computed, whatever the calendar event', () => {
    const at = Math.floor(new Date(2026, 10, 1, 3, 0, 0).getTime() / 1000)

    expect(nextRunDate({ schedule: 'sun 03:00', nextRun: at }, now)?.getTime()).toBe(at * 1000)
  })

  it('computes a plain HH:MM schedule, today or tomorrow', () => {
    expect(nextRunDate({ schedule: '21:30' }, now)).toEqual(new Date(2026, 9, 29, 21, 30, 0))
    expect(nextRunDate({ schedule: '02:00' }, now)).toEqual(new Date(2026, 9, 30, 2, 0, 0))
  })

  it('gives null for a calendar event without next-run instead of an Invalid Date', () => {
    for (const schedule of ['sat 02:00', 'mon..fri 21:00', '*/6:00', 'daily', '0 2 * * *', '']) {
      expect(nextRunDate({ schedule, nextRun: null }, now), schedule).toBeNull()
    }
  })

  it('ignores a zero or missing next-run', () => {
    expect(nextRunDate({ schedule: 'sat 02:00', nextRun: 0 }, now)).toBeNull()
  })
})
