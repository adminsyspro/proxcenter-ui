import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { computeScore, computeWeightedScore, type HardeningCheck, type WeightedHardeningCheck } from './hardening'
import {
  applyRiskAcceptances, isAcceptanceActive, JUSTIFICATION_MAX_LENGTH, parseAcceptanceInput, serializeAcceptance, type RiskAcceptance,
} from './riskAcceptance'

const now = new Date('2026-11-25T12:00:00.000Z')
const later = new Date('2026-12-25T12:00:00.000Z')
const earlier = new Date('2026-11-24T12:00:00.000Z')

const check = (id: string, status: HardeningCheck['status'], maxPoints = 10): HardeningCheck =>
  ({ id, name: id, category: 'node', severity: 'medium', maxPoints, status, earned: status === 'pass' ? maxPoints : 0 })
const acceptance = (checkId: string, expiresAt: Date | null = null): RiskAcceptance =>
  ({ checkId, justification: 'Handled by the host firewall', acceptedBy: 'admin@example.test', acceptedAt: earlier, expiresAt })

describe('isAcceptanceActive', () => {
  it('stands for ever without an expiry, and until the expiry otherwise', () => {
    expect(isAcceptanceActive({ expiresAt: null }, now)).toBe(true)
    expect(isAcceptanceActive({ expiresAt: later }, now)).toBe(true)
    expect(isAcceptanceActive({ expiresAt: earlier }, now)).toBe(false)
    expect(isAcceptanceActive({ expiresAt: now }, now)).toBe(false)
  })
})

describe('applyRiskAcceptances', () => {
  it('turns an accepted fail or warning into accepted, keeping what the check found', () => {
    const out = applyRiskAcceptances(
      [check('node_firewalls', 'fail'), check('cluster_policy_out', 'warning'), check('root_tfa', 'fail')],
      [acceptance('node_firewalls'), acceptance('cluster_policy_out', later)],
      now,
    )

    expect(out[0]).toMatchObject({
      status: 'accepted', rawStatus: 'fail',
      acceptance: { justification: 'Handled by the host firewall', acceptedBy: 'admin@example.test', acceptedAt: earlier.toISOString(), expiresAt: null },
    })
    expect(out[1]).toMatchObject({ status: 'accepted', rawStatus: 'warning', acceptance: { expiresAt: later.toISOString() } })
    expect(out[2]).toEqual(check('root_tfa', 'fail'))
  })

  it('leaves a passing or skipped check alone: the acceptance only matters while it fails', () => {
    const checks = [check('node_firewalls', 'pass'), check('root_tfa', 'skip')]
    expect(applyRiskAcceptances(checks, [acceptance('node_firewalls'), acceptance('root_tfa')], now)).toEqual(checks)
  })

  it('ignores an expired acceptance, so the check fails again on its own', () => {
    const checks = [check('node_firewalls', 'fail')]
    expect(applyRiskAcceptances(checks, [acceptance('node_firewalls', earlier)], now)).toEqual(checks)
  })

  it('returns the same list when nothing is accepted', () => {
    const checks = [check('node_firewalls', 'fail')]
    expect(applyRiskAcceptances(checks, [], now)).toBe(checks)
  })
})

describe('score with accepted risks', () => {
  const checks = [check('a', 'pass'), check('b', 'fail'), check('c', 'fail'), check('d', 'skip')]

  it('takes an accepted check out of the score and counts it apart from the failed ones', () => {
    expect(computeScore(checks)).toMatchObject({ score: 33, failed: 2, accepted: 0, maxApplicable: 30 })

    const accepted = applyRiskAcceptances(checks, [acceptance('b')], now)
    expect(computeScore(accepted)).toMatchObject({ score: 50, failed: 1, accepted: 1, skipped: 1, maxApplicable: 20, total: 4 })
  })

  it('does the same with a weighted profile', () => {
    const weighted: WeightedHardeningCheck[] = checks.map(c => ({ ...c, weight: 2, weightedMaxPoints: c.maxPoints * 2, weightedEarned: c.earned * 2 }))
    const accepted = applyRiskAcceptances(weighted, [acceptance('b'), acceptance('c')], now)
    expect(computeWeightedScore(accepted)).toMatchObject({ score: 100, failed: 0, accepted: 2, maxApplicable: 20 })
  })

  it('never counts an accepted critical check as a critical issue', () => {
    const critical: HardeningCheck = { ...check('root_tfa', 'fail', 20), severity: 'critical' }
    expect(computeScore([critical]).critical).toBe(1)
    expect(computeScore(applyRiskAcceptances([critical], [acceptance('root_tfa')], now)).critical).toBe(0)
  })
})

describe('parseAcceptanceInput', () => {
  const valid = { check_id: 'node_firewalls', justification: '  Handled by the host firewall  ' }

  it('reads a justification, trimmed, with no expiry', () => {
    expect(parseAcceptanceInput(valid, now)).toEqual({ checkId: 'node_firewalls', justification: 'Handled by the host firewall', expiresAt: null })
    expect(parseAcceptanceInput({ ...valid, expires_at: '' }, now)).toMatchObject({ expiresAt: null })
    expect(parseAcceptanceInput({ ...valid, expires_at: null }, now)).toMatchObject({ expiresAt: null })
  })

  it('reads a future expiry', () => {
    expect(parseAcceptanceInput({ ...valid, expires_at: later.toISOString() }, now)).toMatchObject({ expiresAt: later })
  })

  it('refuses an unknown check, a short or oversized justification, a bad or past expiry', () => {
    expect(parseAcceptanceInput(null, now)).toBe('Unknown check')
    expect(parseAcceptanceInput({ ...valid, check_id: 'made_up' }, now)).toBe('Unknown check')
    expect(parseAcceptanceInput({ ...valid, justification: 'too short' }, now)).toMatch(/at least 10 characters/)
    expect(parseAcceptanceInput({ ...valid, justification: 42 }, now)).toMatch(/at least 10 characters/)
    expect(parseAcceptanceInput({ ...valid, justification: 'x'.repeat(JUSTIFICATION_MAX_LENGTH + 1) }, now)).toMatch(/limited to/)
    expect(parseAcceptanceInput({ ...valid, expires_at: 'someday' }, now)).toBe('Invalid expiry date')
    expect(parseAcceptanceInput({ ...valid, expires_at: 12 }, now)).toBe('Invalid expiry date')
    expect(parseAcceptanceInput({ ...valid, expires_at: earlier.toISOString() }, now)).toBe('The expiry date must be in the future')
  })
})

describe('serializeAcceptance', () => {
  it('answers the wire shape, with whether the acceptance still stands', () => {
    expect(serializeAcceptance(acceptance('node_firewalls', later), now)).toEqual({
      check_id: 'node_firewalls', justification: 'Handled by the host firewall', accepted_by: 'admin@example.test',
      accepted_at: earlier.toISOString(), expires_at: later.toISOString(), active: true,
    })
    expect(serializeAcceptance(acceptance('node_firewalls', earlier), now)).toMatchObject({ active: false })
    expect(serializeAcceptance(acceptance('node_firewalls'), now)).toMatchObject({ expires_at: null, active: true })
  })
})
