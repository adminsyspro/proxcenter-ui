import { describe, expect, it } from 'vitest'

import ok from './__fixtures__/status-ok.json'
import lab from './__fixtures__/status-lab-ceph20.json'
import osdDown from './__fixtures__/status-osd-down.json'
import { liveFingerprint, liveFromCephStatus, pgStateClean } from './live'

describe('liveFromCephStatus', () => {
  it('decodes a flat osdmap (fixture)', () => {
    const l = liveFromCephStatus(osdDown, 1234)

    expect(l.at).toBe(1234)
    expect(l.health.status).toBe('HEALTH_WARN')
    expect(l.health.checks.map(c => c.name)).toEqual(['OSD_DOWN', 'OSD_HOST_DOWN', 'PG_DEGRADED'])
    expect(l.health.checks[0]).toMatchObject({ severity: 'HEALTH_WARN', summary: '1 osds down' })
    expect(l.health.checks[0].detail[0].message).toContain('osd.2')
    expect(l.osd).toEqual({ total: 3, up: 2, in: 3 })
    expect(l.pg.total).toBe(33)
    expect(l.pg.clean).toBe(22)
    expect(l.pg.byState).toContainEqual({ state: 'active+undersized+degraded', count: 11 })
    expect(l.io).toEqual({ readOps: 120, writeOps: 240, readBytes: 1048576, writeBytes: 2097152 })
    expect(l.recovery).toEqual({ bytesPerSec: 52428800, objectsPerSec: 13, degraded: 11, misplaced: 0 })
    expect(l.raw).toEqual({ used: 144955146240, total: 1000000000000 })
  })

  it('decodes the real lab output (Ceph 20)', () => {
    const l = liveFromCephStatus(lab, 1)

    expect(l.osd).toEqual({ total: 3, up: 3, in: 3 })
    expect(l.pg).toMatchObject({ total: 129, clean: 129 })
    expect(l.health.status).toBe('HEALTH_ERR')
    expect(l.health.checks).toHaveLength(7)
  })

  it('does not expose the muted checks, which Ceph leaves out of its state', () => {
    const live = liveFromCephStatus({ health: { status: 'HEALTH_OK', checks: {
      OLD: { severity: 'HEALTH_WARN', summary: { message: 'x' }, muted: true },
      NEW: { severity: 'HEALTH_WARN', summary: { message: 'y' }, muted: false },
    } } }, 1)

    expect(live.health.checks.map(c => c.name)).toEqual(['NEW'])
  })

  it('accepts the nested osdmap form', () => {
    const l = liveFromCephStatus({ osdmap: { osdmap: { num_osds: 6, num_up_osds: 5, num_in_osds: 4 } } }, 1)

    expect(l.osd).toEqual({ total: 6, up: 5, in: 4 })
  })

  it('puts 0 on every absent field', () => {
    const l = liveFromCephStatus({}, 7)

    expect(l).toEqual({
      health: { status: '', checks: [] },
      pg: { total: 0, clean: 0, byState: [] },
      osd: { total: 0, up: 0, in: 0 },
      io: { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 },
      recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
      raw: { used: 0, total: 0 },
      at: 7,
    })
  })

  it('survives non-object input', () => {
    expect(liveFromCephStatus(null, 1).osd.total).toBe(0)
    expect(liveFromCephStatus('x', 1).pg.total).toBe(0)
  })
})

describe('liveFingerprint', () => {
  it('changes when osd.up changes', () => {
    const a = liveFromCephStatus(ok, 1)
    const b = { ...a, osd: { ...a.osd, up: a.osd.up - 1 } }

    expect(liveFingerprint(b)).not.toBe(liveFingerprint(a))
  })

  it('ignores io.readOps and the timestamp', () => {
    const a = liveFromCephStatus(ok, 1)
    const b = { ...a, at: 99, io: { ...a.io, readOps: a.io.readOps + 500 } }

    expect(liveFingerprint(b)).toBe(liveFingerprint(a))
  })

  it('is independent of the check order and sensitive to unclean PGs', () => {
    const d = liveFromCephStatus(osdDown, 1)
    const reversed = { ...d, health: { ...d.health, checks: [...d.health.checks].reverse() } }

    expect(liveFingerprint(reversed)).toBe(liveFingerprint(d))
    expect(liveFingerprint({ ...d, pg: { ...d.pg, clean: d.pg.total } })).not.toBe(liveFingerprint(d))
  })

  // I2: during a rebuild the unclean count moves at every poll; it must not reload the inventory each time.
  it('keeps the same fingerprint while the unclean PG count varies, changes when it reaches or leaves 0', () => {
    const d = liveFromCephStatus(osdDown, 1)
    const withUnclean = (n: number) => ({ ...d, pg: { ...d.pg, clean: d.pg.total - n } })

    expect(liveFingerprint(withUnclean(12))).toBe(liveFingerprint(withUnclean(7)))
    expect(liveFingerprint(withUnclean(0))).not.toBe(liveFingerprint(withUnclean(3)))
  })
})

// R19: same cases as the backend collector (internal/cephmetrics, pgStateClean).
describe('pgStateClean', () => {
  it.each([
    ['active+clean', true],
    ['active+clean+snaptrim', true],
    ['active+clean+snaptrim_wait', true],
    ['active+clean+scrubbing+deep', true],
    ['active+undersized+degraded', false],
    ['clean', false],
    ['active+recovering', false],
    ['active+uncleanish', false],
    ['inactive+clean', false],
  ])('%s is %s', (state, clean) => {
    expect(pgStateClean(state)).toBe(clean)
  })

  it('counts snaptrimming PGs as clean in the Live read and its fingerprint', () => {
    const status = { pgmap: { num_pgs: 129, pgs_by_state: [
      { state_name: 'active+clean', count: 109 },
      { state_name: 'active+clean+snaptrim', count: 12 },
      { state_name: 'active+clean+snaptrim_wait', count: 8 },
    ] } }
    const l = liveFromCephStatus(status, 1)

    expect(l.pg.clean).toBe(129)
    expect(liveFingerprint(l).endsWith('|129|false')).toBe(true)
  })
})

