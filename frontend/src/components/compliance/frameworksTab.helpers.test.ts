import { describe, expect, it } from 'vitest'

import { breakdownSegments, buildReportUrl, coverageLabel, FRAMEWORK_LOGOS, gaugeColor, nodeFailCount, scoreColor, sortNodeChecks } from './frameworksTab.helpers'
import type { NodeCheckResult } from '@/lib/compliance/nodeBreakdown'
import { FRAMEWORK_IDS } from '@/lib/compliance/frameworks/types'

describe('frameworksTab helpers', () => {
  describe('buildReportUrl', () => {
    it('builds an encoded report url', () => {
      expect(buildReportUrl('nist-800-171-r2', 'c 1')).toBe(
        '/api/v1/compliance/frameworks/nist-800-171-r2/report?connectionId=c%201',
      )
    })

    it('encodes special characters in connectionId', () => {
      expect(buildReportUrl('cmmc-l2', 'conn&id=x')).toBe(
        '/api/v1/compliance/frameworks/cmmc-l2/report?connectionId=conn%26id%3Dx',
      )
    })

    it('passes through a plain connectionId unchanged', () => {
      expect(buildReportUrl('nist-800-53-r5', 'abc123')).toBe(
        '/api/v1/compliance/frameworks/nist-800-53-r5/report?connectionId=abc123',
      )
    })
  })

  describe('coverageLabel', () => {
    it('formats coverage as assessed / total', () => {
      expect(coverageLabel({ assessedControls: 5, totalControls: 110 } as any)).toBe('5 / 110')
    })

    it('handles zero assessed', () => {
      expect(coverageLabel({ assessedControls: 0, totalControls: 50 } as any)).toBe('0 / 50')
    })
  })

  describe('scoreColor', () => {
    it('returns green for score >= 80', () => {
      expect(scoreColor(80)).toBe('#22c55e')
      expect(scoreColor(100)).toBe('#22c55e')
    })

    it('returns amber for score >= 50 and < 80', () => {
      expect(scoreColor(50)).toBe('#f59e0b')
      expect(scoreColor(79)).toBe('#f59e0b')
    })

    it('returns red for score < 50', () => {
      expect(scoreColor(49)).toBe('#ef4444')
      expect(scoreColor(0)).toBe('#ef4444')
    })
  })

  describe('gaugeColor', () => {
    it('returns muted color for null score', () => {
      expect(gaugeColor(null)).toBe('#94a3b8')
    })

    it('returns green for score >= 80', () => {
      expect(gaugeColor(80)).toBe('#22c55e')
      expect(gaugeColor(100)).toBe('#22c55e')
    })

    it('returns amber for score >= 50 and < 80', () => {
      expect(gaugeColor(60)).toBe('#f59e0b')
      expect(gaugeColor(50)).toBe('#f59e0b')
    })

    it('returns red for score < 50', () => {
      expect(gaugeColor(0)).toBe('#ef4444')
      expect(gaugeColor(49)).toBe('#ef4444')
    })
  })

  describe('sortNodeChecks', () => {
    function makeCheck(status: string, id = status): NodeCheckResult {
      return { id, name: id, category: 'test', severity: 'medium', status }
    }

    it('sorts fail before warning before pass before skip', () => {
      const input = [
        makeCheck('skip'),
        makeCheck('pass'),
        makeCheck('warning'),
        makeCheck('fail'),
      ]
      const sorted = sortNodeChecks(input)
      expect(sorted.map(c => c.status)).toEqual(['fail', 'warning', 'pass', 'skip'])
    })

    it('treats partial as worse than pass but better than warning', () => {
      const input = [makeCheck('pass'), makeCheck('partial'), makeCheck('warning')]
      const sorted = sortNodeChecks(input)
      expect(sorted.map(c => c.status)).toEqual(['warning', 'partial', 'pass'])
    })

    it('treats satisfied same as pass (after fail/warning)', () => {
      const input = [makeCheck('satisfied'), makeCheck('fail')]
      const sorted = sortNodeChecks(input)
      expect(sorted[0].status).toBe('fail')
    })

    it('does not mutate the original array', () => {
      const input = [makeCheck('pass'), makeCheck('fail')]
      sortNodeChecks(input)
      expect(input[0].status).toBe('pass')
    })
  })

  describe('breakdownSegments', () => {
    it('returns three segments with proportional pct for a normal case', () => {
      const a = { satisfied: 6, partial: 2, failed: 2, assessedControls: 10 }
      const segs = breakdownSegments(a)
      expect(segs).toHaveLength(3)
      expect(segs[0]).toMatchObject({ key: 'satisfied', color: '#22c55e', pct: 60, count: 6 })
      expect(segs[1]).toMatchObject({ key: 'partial',   color: '#f59e0b', pct: 20, count: 2 })
      expect(segs[2]).toMatchObject({ key: 'failed',    color: '#ef4444', pct: 20, count: 2 })
    })

    it('pct values sum to ~100 for a normal case (rounding)', () => {
      const a = { satisfied: 1, partial: 1, failed: 1, assessedControls: 3 }
      const segs = breakdownSegments(a)
      const sum = segs.reduce((acc, s) => acc + s.pct, 0)
      // each is 33.3 -> rounded to 33, sum = 99 (acceptable)
      expect(sum).toBeGreaterThanOrEqual(99)
      expect(sum).toBeLessThanOrEqual(101)
    })

    it('returns pct 0 for all segments when assessedControls is 0', () => {
      const a = { satisfied: 0, partial: 0, failed: 0, assessedControls: 0 }
      const segs = breakdownSegments(a)
      for (const s of segs) {
        expect(s.pct).toBe(0)
        expect(s.count).toBe(0)
      }
    })

    it('returns pct 100 for satisfied when all are satisfied', () => {
      const a = { satisfied: 5, partial: 0, failed: 0, assessedControls: 5 }
      const segs = breakdownSegments(a)
      expect(segs[0].pct).toBe(100)
      expect(segs[1].pct).toBe(0)
      expect(segs[2].pct).toBe(0)
    })
  })

  describe('FRAMEWORK_LOGOS', () => {
    it('maps every registered framework to a logo asset path', () => {
      for (const id of FRAMEWORK_IDS) {
        expect(FRAMEWORK_LOGOS[id]).toMatch(/^\/images\/frameworks\/.+\.(png|webp)$/)
      }
    })

    it('reuses the NIST wordmark for both NIST frameworks', () => {
      expect(FRAMEWORK_LOGOS['nist-800-53-r5']).toBe(FRAMEWORK_LOGOS['nist-800-171-r2'])
    })
  })

  describe('nodeFailCount', () => {
    function makeCheck(status: string): NodeCheckResult {
      return { id: status, name: status, category: 'test', severity: 'medium', status }
    }

    it('counts fail and warning and partial as failures', () => {
      const checks = [
        makeCheck('fail'),
        makeCheck('warning'),
        makeCheck('partial'),
        makeCheck('pass'),
        makeCheck('satisfied'),
        makeCheck('skip'),
      ]
      expect(nodeFailCount(checks)).toBe(3)
    })

    it('returns 0 when all pass or skip', () => {
      expect(nodeFailCount([makeCheck('pass'), makeCheck('skip'), makeCheck('satisfied')])).toBe(0)
    })

    it('returns 0 for empty array', () => {
      expect(nodeFailCount([])).toBe(0)
    })
  })
})
