import { describe, expect, it } from 'vitest'

import { formatBandwidth, formatPressure } from './diskIo'

describe('formatBandwidth', () => {
  it('prints bytes per second in binary steps, whole bytes and one decimal above', () => {
    expect(formatBandwidth(0)).toBe('0 B/s')
    expect(formatBandwidth(512)).toBe('512 B/s')
    expect(formatBandwidth(1536)).toBe('1.5 KB/s')
    expect(formatBandwidth(3.5 * 1024 * 1024)).toBe('3.5 MB/s')
    expect(formatBandwidth(2 * 1024 ** 3)).toBe('2.0 GB/s')
    expect(formatBandwidth(5 * 1024 ** 4)).toBe('5120.0 GB/s')
  })

  it('prints a dash for a figure that is not a rate', () => {
    expect(formatBandwidth(Number.NaN)).toBe('—')
    expect(formatBandwidth(-1)).toBe('—')
    expect(formatBandwidth(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatPressure', () => {
  it('prints the stall share as a percentage with one decimal', () => {
    expect(formatPressure(0)).toBe('0.0%')
    expect(formatPressure(12.345)).toBe('12.3%')
    expect(formatPressure(100)).toBe('100.0%')
  })

  it('prints a dash for a figure that is not a share', () => {
    expect(formatPressure(Number.NaN)).toBe('—')
    expect(formatPressure(-0.5)).toBe('—')
  })
})
