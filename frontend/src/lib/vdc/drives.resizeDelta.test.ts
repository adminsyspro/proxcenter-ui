import { describe, expect, it } from 'vitest'

import { resizeDeltaMb } from './drives'

describe('resizeDeltaMb', () => {
  it('a relative size is its own growth', () => {
    expect(resizeDeltaMb('+10G', '32G')).toBe(10240)
    expect(resizeDeltaMb('+512M', '32G')).toBe(512)
    expect(resizeDeltaMb('+1T', null)).toBe(1024 * 1024)
  })

  it('an absolute size grows the disk by the difference with its current size', () => {
    expect(resizeDeltaMb('64G', '32G')).toBe(32 * 1024)
    expect(resizeDeltaMb('2G', '1G')).toBe(1024)
    expect(resizeDeltaMb('2048M', '1G')).toBe(1024)
  })

  it('an absolute size at or below the current size adds nothing', () => {
    expect(resizeDeltaMb('32G', '32G')).toBe(0)
    expect(resizeDeltaMb('16G', '32G')).toBe(0)
  })

  it('counts the whole target when the current size is unknown', () => {
    expect(resizeDeltaMb('64G', null)).toBe(64 * 1024)
  })

  it('reads a size without unit in GB and an unparseable one as nothing', () => {
    expect(resizeDeltaMb('+10', '32G')).toBe(10240)
    expect(resizeDeltaMb('abc', '32G')).toBe(0)
  })
})
