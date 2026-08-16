import { describe, it, expect } from 'vitest'

import { summarizeScan } from './normalize'

describe('summarizeScan', () => {
  // Measured strings from a real pool.
  it('keeps the scrub line as-is and reports no errors', () => {
    const res = summarizeScan(
      'scrub repaired 0B in 00:00:00 with 0 errors on Sun Jul 12 00:24:01 2026',
      'No known data errors',
    )

    expect(res.label).toContain('scrub repaired 0B')
    expect(res.hasErrors).toBe(false)
  })

  it('flags a non-zero error count in the scan line', () => {
    const res = summarizeScan('scrub repaired 0B in 00:01:00 with 3 errors on Sun Jul 12', 'No known data errors')

    expect(res.hasErrors).toBe(true)
  })

  it('flags an errors field that is not the all-clear sentence', () => {
    const res = summarizeScan(null, 'Permanent errors have been detected')

    expect(res.hasErrors).toBe(true)
  })

  it('returns a null label when there is no scan information', () => {
    expect(summarizeScan(null, null)).toEqual({ label: null, hasErrors: false })
  })

  it('ignores a non-string scan value instead of throwing', () => {
    expect(summarizeScan({ progress: 10 }, null).label).toBeNull()
  })
})
