import { describe, it, expect } from 'vitest'

import { formatBytes, formatStorageSize, formatUptime } from './format'

describe('formatBytes (1024-based)', () => {
  it('returns "0 B" for 0', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('returns "0 B" for Number.NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('returns "0 B" for undefined/null', () => {
    expect(formatBytes(undefined as any)).toBe('0 B')
    expect(formatBytes(null as any)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats KiB', () => {
    expect(formatBytes(1024)).toBe('1 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
  })

  it('formats MiB', () => {
    expect(formatBytes(1048576)).toBe('1 MiB')
  })

  it('formats GiB', () => {
    expect(formatBytes(1073741824)).toBe('1 GiB')
  })

  it('formats TiB', () => {
    expect(formatBytes(1099511627776)).toBe('1 TiB')
  })

  it('respects custom decimals', () => {
    expect(formatBytes(1536, 0)).toBe('2 KiB')
    expect(formatBytes(1536, 1)).toBe('1.5 KiB')
    expect(formatBytes(1536, 3)).toBe('1.5 KiB')
  })

  it('treats negative decimals as 0', () => {
    expect(formatBytes(1536, -1)).toBe('2 KiB')
  })
})

describe('formatStorageSize (1000-based)', () => {
  it('returns "0 B" for 0', () => {
    expect(formatStorageSize(0)).toBe('0 B')
  })

  it('returns "0 B" for Number.NaN', () => {
    expect(formatStorageSize(Number.NaN)).toBe('0 B')
  })

  it('formats KB (1000)', () => {
    expect(formatStorageSize(1000)).toBe('1 KB')
    expect(formatStorageSize(1500)).toBe('1.5 KB')
  })

  it('formats MB', () => {
    expect(formatStorageSize(1000000)).toBe('1 MB')
  })

  it('formats GB', () => {
    expect(formatStorageSize(1000000000)).toBe('1 GB')
  })

  it('formats TB', () => {
    expect(formatStorageSize(1000000000000)).toBe('1 TB')
  })

  it('respects custom decimals', () => {
    expect(formatStorageSize(1500, 0)).toBe('2 KB')
    expect(formatStorageSize(1500, 1)).toBe('1.5 KB')
  })
})

describe('formatUptime', () => {
  it('returns "0s" for 0', () => {
    expect(formatUptime(0)).toBe('0s')
  })

  it('returns "0s" for negative', () => {
    expect(formatUptime(-10)).toBe('0s')
  })

  it('returns "0s" for Number.NaN/undefined', () => {
    expect(formatUptime(Number.NaN)).toBe('0s')
    expect(formatUptime(undefined as any)).toBe('0s')
  })

  it('formats minutes only', () => {
    expect(formatUptime(120)).toBe('2m')
    expect(formatUptime(60)).toBe('1m')
    expect(formatUptime(30)).toBe('0m')
  })

  it('formats hours and minutes', () => {
    expect(formatUptime(3600)).toBe('1h 0m')
    expect(formatUptime(3660)).toBe('1h 1m')
    expect(formatUptime(7200)).toBe('2h 0m')
  })

  it('formats days and hours', () => {
    expect(formatUptime(86400)).toBe('1d 0h')
    expect(formatUptime(90000)).toBe('1d 1h')
    expect(formatUptime(172800)).toBe('2d 0h')
  })
})
