import { describe, expect, it } from 'vitest'

import { liveFingerprint } from './live'
import type { CephLive } from './live'
import { monDiskChecks, withMonDisk, withoutMonDisk } from './monDisk'
import type { CephHealthIssue } from './types'

const disk = (mon: string, availPct: number) => ({ mon, node: mon, availBytes: availPct * 1e9, totalBytes: 100e9, availPct })
const THREE = [disk('pve1-dr', 3.4), disk('pve2-dr', 14.2), disk('pve3-dr', 17.9)]

const issue = (name: string, severity: string, summary: string, detail: string[] = []): CephHealthIssue => ({ name, severity, summary, detail: detail.map(message => ({ message })) })

const live = (status: string, checks: CephHealthIssue[]): CephLive => ({
  health: { status, checks },
  pg: { total: 1, clean: 1, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 0, total: 0 },
  at: 1,
})

// What Ceph says on each poll: the same cluster, one monitor cited at a time.
const cited = {
  pve1: live('HEALTH_ERR', [issue('MON_DISK_CRIT', 'HEALTH_ERR', 'mon pve1-dr is very low on available space', ['mon.pve1-dr has 3% avail'])]),
  pve2: live('HEALTH_WARN', [issue('MON_DISK_LOW', 'HEALTH_WARN', 'mon pve2-dr is low on available space', ['mon.pve2-dr has 14% avail'])]),
  pve3: live('HEALTH_WARN', [issue('MON_DISK_LOW', 'HEALTH_WARN', 'mon pve3-dr is low on available space', ['mon.pve3-dr has 17% avail'])]),
  none: live('HEALTH_OK', []),
}

describe('monDiskChecks', () => {
  it('turns 3 / 14 / 17 percent into one CRIT for pve1 and one LOW for pve2 and pve3, in the format of Ceph', () => {
    expect(monDiskChecks(THREE)).toEqual([
      issue('MON_DISK_CRIT', 'HEALTH_ERR', 'mon pve1-dr is very low on available space', ['mon.pve1-dr has 3% avail']),
      issue('MON_DISK_LOW', 'HEALTH_WARN', 'mons pve2-dr,pve3-dr are low on available space', ['mon.pve2-dr has 14% avail', 'mon.pve3-dr has 17% avail']),
    ])
  })

  it('words the same whatever the order of the monitors', () => {
    expect(monDiskChecks([...THREE].reverse())).toEqual(monDiskChecks(THREE))
  })

  it('raises nothing when every mon is above 30 percent', () => {
    expect(monDiskChecks([disk('a', 31), disk('b', 80)])).toEqual([])
  })

  it('uses the thresholds of Ceph on the whole percent: 5 is critical, 30 is low, 31 is fine', () => {
    expect(monDiskChecks([disk('a', 5.9)]).map(c => c.name)).toEqual(['MON_DISK_CRIT'])
    expect(monDiskChecks([disk('a', 6)]).map(c => c.name)).toEqual(['MON_DISK_LOW'])
    expect(monDiskChecks([disk('a', 30.9)]).map(c => c.name)).toEqual(['MON_DISK_LOW'])
    expect(monDiskChecks([disk('a', 31)]).map(c => c.name)).toEqual([])
  })

  it('words several critical mons in the plural', () => {
    expect(monDiskChecks([disk('a', 1), disk('b', 2)])[0].summary).toBe('mons a,b are very low on available space')
  })
})

describe('withMonDisk', () => {
  it('shows the same checks whichever mon Ceph cites', () => {
    const shown = Object.values(cited).map(l => withMonDisk(l, THREE))

    for (const s of shown) expect(s.health).toEqual(shown[0].health)
    expect(shown[0].health.status).toBe('HEALTH_ERR')
    expect(shown[0].health.checks.map(c => c.name)).toEqual(['MON_DISK_CRIT', 'MON_DISK_LOW'])
    expect(new Set(shown.map(liveFingerprint)).size).toBe(1)
  })

  it('keeps the other checks of Ceph and takes the worst severity of the displayed ones', () => {
    const other = issue('OSD_DOWN', 'HEALTH_WARN', '1 osds down', ['osd.1 is down'])
    const shown = withMonDisk(live('HEALTH_WARN', [other, ...cited.pve2.health.checks]), [disk('a', 20)])

    expect(shown.health.checks.map(c => c.name)).toEqual(['OSD_DOWN', 'MON_DISK_LOW'])
    expect(shown.health.status).toBe('HEALTH_WARN')
  })

  it('is HEALTH_OK when Ceph cited a mon but every mon is above the thresholds now', () => {
    const shown = withMonDisk(cited.pve1, [disk('pve1-dr', 60)])

    expect(shown.health).toEqual({ status: 'HEALTH_OK', checks: [] })
  })

  it('keeps the raw checks of Ceph without any measure yet (inventory not back, or no node readable)', () => {
    expect(withMonDisk(cited.pve1, undefined)).toBe(cited.pve1)
    expect(withMonDisk(cited.pve1, [])).toBe(cited.pve1)
  })

  it('leaves an unknown global state alone', () => {
    expect(withMonDisk(live('', []), [disk('a', 60)]).health.status).toBe('')
  })
})

describe('withMonDisk, global state (Ceph state corrected, then the worst of the rebuilt checks)', () => {
  const warn = (name: string) => issue(name, 'HEALTH_WARN', name)

  it('keeps Ceph ERR when no MON_DISK_* was involved and the mons are healthy', () => {
    const shown = withMonDisk(live('HEALTH_ERR', [issue('OSD_SCRUB_ERRORS', 'HEALTH_ERR', '2 scrub errors')]), [disk('a', 60)])

    expect(shown.health.status).toBe('HEALTH_ERR')
  })

  it('stays OK when Ceph is OK, whatever muted check there was (muted checks are not exposed)', () => {
    const shown = withMonDisk(live('HEALTH_OK', []), [disk('a', 60)])

    expect(shown.health).toEqual({ status: 'HEALTH_OK', checks: [] })
  })

  it('drops to the worst remaining check when a lone raw MON_DISK_CRIT justified Ceph ERR and the mons are healthy now', () => {
    const shown = withMonDisk(live('HEALTH_ERR', [cited.pve1.health.checks[0], warn('OSD_DOWN')]), [disk('pve1-dr', 60)])

    expect(shown.health.status).toBe('HEALTH_WARN')
    expect(shown.health.checks.map(c => c.name)).toEqual(['OSD_DOWN'])
  })

  it('keeps Ceph ERR when another check has that severity too', () => {
    const shown = withMonDisk(live('HEALTH_ERR', [cited.pve1.health.checks[0], issue('PG_DAMAGED', 'HEALTH_ERR', 'damaged')]), [disk('pve1-dr', 60)])

    expect(shown.health.status).toBe('HEALTH_ERR')
  })

  it('keeps Ceph WARN with no check at all', () => {
    expect(withMonDisk(live('HEALTH_WARN', []), [disk('a', 60)]).health.status).toBe('HEALTH_WARN')
  })

  it('raises the state with the rebuilt checks', () => {
    expect(withMonDisk(live('HEALTH_OK', []), [disk('a', 2)]).health.status).toBe('HEALTH_ERR')
    expect(withMonDisk(live('HEALTH_OK', []), [disk('a', 20)]).health.status).toBe('HEALTH_WARN')
  })
})

describe('withMonDisk, a mon Ceph cites but nobody could measure', () => {
  it('keeps the line of Ceph for that mon next to the measured ones', () => {
    const shown = withMonDisk(cited.pve1, [disk('pve2-dr', 14.2)])

    expect(shown.health.checks.map(c => [c.name, c.detail.map(d => d.message)])).toEqual([
      ['MON_DISK_CRIT', ['mon.pve1-dr has 3% avail']],
      ['MON_DISK_LOW', ['mon.pve2-dr has 14% avail']],
    ])
    expect(shown.health.status).toBe('HEALTH_ERR')
  })

  it('does not duplicate a mon that was measured', () => {
    const shown = withMonDisk(cited.pve2, [disk('pve2-dr', 14.2)])

    expect(shown.health.checks).toEqual([issue('MON_DISK_LOW', 'HEALTH_WARN', 'mon pve2-dr is low on available space', ['mon.pve2-dr has 14% avail'])])
  })
})

describe('withoutMonDisk', () => {
  it('gives an inventory fingerprint that does not move with the mon Ceph cites', () => {
    const prints = new Set(Object.values(cited).map(l => liveFingerprint(withoutMonDisk(l))))

    expect(prints.size).toBe(1)
  })
})
