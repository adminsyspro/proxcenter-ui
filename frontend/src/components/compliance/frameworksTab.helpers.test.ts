import { describe, expect, it } from 'vitest'

import { buildReportUrl, coverageLabel, scoreColor } from './frameworksTab.helpers'

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
})
