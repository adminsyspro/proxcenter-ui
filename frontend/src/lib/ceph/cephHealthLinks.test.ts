import { describe, expect, it } from 'vitest'

import { compareHealthChecks, healthTarget } from './cephHealthLinks'
import type { CephHealthIssue } from './types'

const issue = (name: string, details: string[] = []): CephHealthIssue => ({
  name,
  severity: 'HEALTH_WARN',
  summary: name,
  detail: details.map(message => ({ message })),
})

describe('healthTarget', () => {
  it.each(['OSD_DOWN', 'OSD_HOST_DOWN'])('%s opens the down filter', code => {
    expect(healthTarget(issue(code))).toEqual({ tab: 'osd', filter: 'down' })
  })

  it.each(['OSD_NEARFULL', 'OSD_BACKFILLFULL', 'OSD_FULL'])('%s opens the problem filter', code => {
    expect(healthTarget(issue(code))).toEqual({ tab: 'osd', filter: 'problem' })
  })

  it('targets the single OSD cited by a fullness check', () => {
    expect(healthTarget(issue('OSD_NEARFULL', ['osd.3 is near full']))).toEqual({
      tab: 'osd',
      filter: 'problem',
      item: { kind: 'osd', id: 3 },
    })
  })

  it('keeps the problem filter only when several OSDs are cited', () => {
    expect(healthTarget(issue('OSD_FULL', ['osd.3 is full', 'osd.4 is full']))).toEqual({ tab: 'osd', filter: 'problem' })
  })

  it.each(['OSD_SCRUB_ERRORS', 'PG_DAMAGED'])('%s targets the cited OSD', code => {
    expect(healthTarget(issue(code, ['pg 2.1f on osd.5 is inconsistent']))).toEqual({
      tab: 'osd',
      item: { kind: 'osd', id: 5 },
    })
  })

  it('falls back to the first acting OSD of a damaged PG', () => {
    expect(healthTarget(issue('PG_DAMAGED', ['pg 2.1f is active+clean+inconsistent, acting [1,0,2]']))).toEqual({
      tab: 'osd',
      item: { kind: 'osd', id: 1 },
    })
  })

  it('falls back to the problem filter when no OSD is cited', () => {
    expect(healthTarget(issue('OSD_SCRUB_ERRORS', ['2 scrub errors']))).toEqual({ tab: 'osd', filter: 'problem' })
  })

  it.each(['POOL_NEAR_FULL', 'POOL_FULL', 'POOL_TOO_FEW_PGS', 'POOL_TOO_MANY_PGS'])('%s targets the pool', code => {
    expect(healthTarget(issue(code, ["pool 'ceph-vm' is nearfull"]))).toEqual({
      tab: 'pools',
      item: { kind: 'pool', name: 'ceph-vm' },
    })
  })

  it('opens the pools tab when no pool is named', () => {
    expect(healthTarget(issue('POOL_FULL'))).toEqual({ tab: 'pools' })
  })

  it.each(['MON_DOWN', 'MON_CLOCK_SKEW', 'MGR_DOWN', 'MDS_ALL_DOWN', 'MDS_DAMAGE', 'FS_DEGRADED', 'FS_WITH_FAILED_MDS', 'RECENT_CRASH'])(
    '%s opens services',
    code => {
      expect(healthTarget(issue(code))).toEqual({ tab: 'services' })
    },
  )

  it.each(['OSDMAP_FLAGS', 'OSD_FLAGS'])('%s focuses the flags', code => {
    expect(healthTarget(issue(code))).toEqual({ tab: 'overview', focus: 'flags' })
  })

  it.each(['PG_DEGRADED', 'PG_AVAILABILITY', 'PG_NOT_SCRUBBED', 'PG_NOT_DEEP_SCRUBBED', 'OBJECT_MISPLACED'])(
    '%s opens the performance tab',
    code => {
      expect(healthTarget(issue(code))).toEqual({ tab: 'perf' })
    },
  )

  it('returns null for an unknown code', () => {
    expect(healthTarget(issue('SOMETHING_NEW'))).toBeNull()
  })
})

describe('compareHealthChecks', () => {
  const sev = (name: string, severity: string): CephHealthIssue => ({ name, severity, summary: name, detail: [] })

  it('never returns NaN for two codes outside the table', () => {
    const r = compareHealthChecks(sev('AUTH_B', 'HEALTH_ERR'), sev('AUTH_A', 'HEALTH_ERR'))

    expect(Number.isNaN(r)).toBe(false)
    expect(r).toBeGreaterThan(0)
  })

  it('orders by severity, then table rank, then code', () => {
    const input = [sev('ZETA', 'HEALTH_WARN'), sev('OSD_DOWN', 'HEALTH_WARN'), sev('ALPHA', 'HEALTH_WARN'), sev('BETA', 'HEALTH_ERR'), sev('PG_DAMAGED', 'HEALTH_ERR')]
    const names = (list: CephHealthIssue[]) => [...list].sort(compareHealthChecks).map(c => c.name)

    expect(names(input)).toEqual(['PG_DAMAGED', 'BETA', 'OSD_DOWN', 'ALPHA', 'ZETA'])
    expect(names([...input].reverse())).toEqual(names(input))
  })

  // Code-unit order, not the locale's: in ASCII '_' (0x5F) comes after the capitals,
  // while ICU collations put punctuation first ('A_B'.localeCompare('AB') < 0).
  it('compares codes in ASCII order whatever the language', () => {
    expect(compareHealthChecks(sev('A_B', 'HEALTH_WARN'), sev('AB', 'HEALTH_WARN'))).toBeGreaterThan(0)
    expect(compareHealthChecks(sev('AUTH_INSECURE_SERVICE_KEY_TYPE', 'HEALTH_ERR'), sev('AUTH_INSECURE_SERVICE_TICKETS', 'HEALTH_ERR'))).toBeLessThan(0)
  })

  it('is zero only for the same code and severity', () => {
    expect(compareHealthChecks(sev('X', 'HEALTH_WARN'), sev('X', 'HEALTH_WARN'))).toBe(0)
  })
})
