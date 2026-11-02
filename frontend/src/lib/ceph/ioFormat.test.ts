import { describe, expect, it } from 'vitest'

import { formatByteRate, formatOps } from './ioFormat'

const format = { number: (v: number, o?: { maximumFractionDigits?: number }) => String(Number(v.toFixed(o?.maximumFractionDigits ?? 3))) }

describe('ioFormat', () => {
  it('ops: one decimal under 10, none above, zero stays 0', () => {
    expect(formatOps(format, 8.54)).toBe('8.5')
    expect(formatOps(format, 120.4)).toBe('120')
    expect(formatOps(format, 0)).toBe('0')
  })

  it('byte rates use binary units', () => {
    expect(formatByteRate(format, 512)).toBe('512 B/s')
    expect(formatByteRate(format, 3 * 1024 * 1024)).toBe('3 MiB/s')
    expect(formatByteRate(format, 1536)).toBe('1.5 KiB/s')
  })
})
