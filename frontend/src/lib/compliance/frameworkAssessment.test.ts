// frameworkAssessment.test.ts
import { describe, it, expect } from 'vitest'
import { assessFramework } from './frameworkAssessment'
import type { HardeningCheck } from './hardening'
import type { FrameworkDef, Crosswalk } from './frameworks/types'

const def: FrameworkDef = {
  id: 'nist-800-171-r2', name: 'X', version: 'r2', sourceUrl: '',
  controls: [
    { id: 'A', title: 'a', family: 'F1' },
    { id: 'B', title: 'b', family: 'F1' },
    { id: 'C', title: 'c', family: 'F2' }, // unmapped -> not_assessed
  ],
}
const crosswalk: Crosswalk = {
  chk_pass: { controlIds: ['A'], rationale: '' },
  chk_fail: { controlIds: ['B'], rationale: '' },
}
const check = (id: string, status: HardeningCheck['status'], details?: string): HardeningCheck =>
  ({ id, name: id, category: 'os', severity: 'low', maxPoints: 5, status, earned: 0, details })

describe('assessFramework', () => {
  it('derives control statuses and a pass-rate score over assessed controls', () => {
    const a = assessFramework([check('chk_pass', 'pass'), check('chk_fail', 'fail')], def, crosswalk)
    expect(a.controls.find(c => c.id === 'A')!.status).toBe('satisfied')
    expect(a.controls.find(c => c.id === 'B')!.status).toBe('failed')
    expect(a.controls.find(c => c.id === 'C')!.status).toBe('not_assessed')
    expect(a.assessedControls).toBe(2)
    expect(a.totalControls).toBe(3)
    expect(a.satisfied).toBe(1)
    expect(a.score).toBe(50) // 1 satisfied / 2 assessed
    expect(a.coverage).toBeCloseTo(2 / 3)
  })
  it('treats a mix as partial', () => {
    const cw: Crosswalk = { p: { controlIds: ['A'], rationale: '' }, f: { controlIds: ['A'], rationale: '' } }
    const a = assessFramework([check('p', 'pass'), check('f', 'fail')], def, cw)
    expect(a.controls.find(c => c.id === 'A')!.status).toBe('partial')
  })
  it('skips do not count as assessed; all-skip -> score null', () => {
    const a = assessFramework([check('chk_pass', 'skip'), check('chk_fail', 'skip')], def, crosswalk)
    expect(a.assessedControls).toBe(0)
    expect(a.score).toBeNull()
  })
  it('family breakdown reconciles with totals', () => {
    const a = assessFramework([check('chk_pass', 'pass'), check('chk_fail', 'fail')], def, crosswalk)
    const sum = (k: keyof typeof a.families[number]) => a.families.reduce((n, f) => n + (f[k] as number), 0)
    expect(sum('satisfied')).toBe(a.satisfied)
    expect(sum('notAssessed')).toBe(a.notAssessed)
  })
  it('warning-only mapped check -> control status partial, counts as assessed', () => {
    // A control whose sole applicable check has status warning must be partial, not satisfied/failed/not_assessed.
    const cw: Crosswalk = { chk_warn: { controlIds: ['A'], rationale: '' } }
    const a = assessFramework([check('chk_warn', 'warning')], def, cw)
    expect(a.controls.find(c => c.id === 'A')!.status).toBe('partial')
    expect(a.assessedControls).toBeGreaterThanOrEqual(1)
  })
  it('carries details from HardeningCheck into AssessedControl.checks', () => {
    const cw: Crosswalk = { chk_with_details: { controlIds: ['A'], rationale: '' }, chk_no_details: { controlIds: ['A'], rationale: '' } }
    const a = assessFramework([
      check('chk_with_details', 'fail', 'node2: PermitRootLogin=yes'),
      check('chk_no_details', 'pass'),
    ], def, cw)
    const ctrl = a.controls.find(c => c.id === 'A')!
    const withDetails = ctrl.checks.find(c => c.id === 'chk_with_details')!
    const noDetails = ctrl.checks.find(c => c.id === 'chk_no_details')!
    expect(withDetails.details).toBe('node2: PermitRootLogin=yes')
    expect(noDetails.details).toBeUndefined()
  })
  it('mixed pass+skip -> control status satisfied (skip filtered from applicable)', () => {
    // The skip check is excluded from applicable checks; the remaining pass check yields satisfied.
    const cw: Crosswalk = {
      chk_pass2: { controlIds: ['A'], rationale: '' },
      chk_skip2: { controlIds: ['A'], rationale: '' },
    }
    const a = assessFramework([check('chk_pass2', 'pass'), check('chk_skip2', 'skip')], def, cw)
    expect(a.controls.find(c => c.id === 'A')!.status).toBe('satisfied')
  })
})
