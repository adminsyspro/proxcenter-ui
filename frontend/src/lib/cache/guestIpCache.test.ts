import { beforeEach, describe, expect, it } from 'vitest'

import {
  GUEST_IP_REFRESH_MS,
  __resetGuestIpIndexForTests,
  deleteGuestIpEntry,
  getGuestIpEntry,
  getGuestIpGeneration,
  getGuestIpIndex,
  getGuestIpInflight,
  guestKey,
  invalidateGuestIpIndex,
  isGuestIpIndexDue,
  setGuestIpIndex,
  setGuestIpInflight,
} from './guestIpCache'

beforeEach(() => {
  __resetGuestIpIndexForTests()
})

describe('guestIpCache', () => {
  it('builds stable guest keys from string and numeric ids', () => {
    expect(guestKey('qemu', 100)).toBe('qemu/100')
    expect(guestKey('lxc', '101')).toBe('lxc/101')
  })

  it('returns null for an index and entry that were never stored', () => {
    expect(getGuestIpIndex('missing')).toBeNull()
    expect(getGuestIpEntry('missing', 'qemu/100')).toBeNull()
  })

  it('stores and reads a connection index and individual entry', () => {
    const entry = { ips: ['10.0.0.5'], macs: ['BC:24:11:C0:F0:6F'], seenAt: 100, stale: false }
    const entries = new Map([['qemu/100', entry]])

    setGuestIpIndex('conn-1', entries, 100)

    expect(getGuestIpIndex('conn-1')).toBe(entries)
    expect(getGuestIpEntry('conn-1', 'qemu/100')).toBe(entry)
  })

  it('is due before first build and at the refresh boundary', () => {
    expect(isGuestIpIndexDue('conn-1', 10)).toBe(true)

    setGuestIpIndex('conn-1', new Map(), 100)

    expect(isGuestIpIndexDue('conn-1', 100 + GUEST_IP_REFRESH_MS - 1)).toBe(false)
    expect(isGuestIpIndexDue('conn-1', 100 + GUEST_IP_REFRESH_MS)).toBe(true)
  })

  it('sets, reads and clears an inflight promise', () => {
    const inflight = Promise.resolve()

    setGuestIpInflight('conn-1', inflight)
    expect(getGuestIpInflight('conn-1')).toBe(inflight)

    setGuestIpInflight('conn-1', null)
    expect(getGuestIpInflight('conn-1')).toBeNull()
  })

  it('invalidates one connection without removing another', () => {
    setGuestIpIndex('conn-1', new Map(), 100)
    setGuestIpIndex('conn-2', new Map(), 100)

    invalidateGuestIpIndex('conn-1')

    expect(getGuestIpIndex('conn-1')).toBeNull()
    expect(getGuestIpIndex('conn-2')).not.toBeNull()
  })

  it('invalidates all connection indexes', () => {
    setGuestIpIndex('conn-1', new Map(), 100)
    setGuestIpIndex('conn-2', new Map(), 100)

    invalidateGuestIpIndex()

    expect(getGuestIpIndex('conn-1')).toBeNull()
    expect(getGuestIpIndex('conn-2')).toBeNull()
  })

  it('reset clears both indexes and inflight promises', () => {
    setGuestIpIndex('conn-1', new Map(), 100)
    setGuestIpInflight('conn-1', Promise.resolve())

    __resetGuestIpIndexForTests()

    expect(getGuestIpIndex('conn-1')).toBeNull()
    expect(getGuestIpInflight('conn-1')).toBeNull()
  })
})

describe('lifecycle hooks', () => {
  beforeEach(() => {
    __resetGuestIpIndexForTests()
  })

  it('forgets a single destroyed guest and keeps the others', () => {
    setGuestIpIndex('conn-1', new Map([
      ['qemu/100', { ips: ['10.0.0.5'], macs: [], seenAt: 1, stale: false }],
      ['lxc/101', { ips: ['10.0.0.6'], macs: [], seenAt: 1, stale: false }],
    ]))

    deleteGuestIpEntry('conn-1', guestKey('qemu', 100))

    expect(getGuestIpEntry('conn-1', 'qemu/100')).toBeNull()
    expect(getGuestIpEntry('conn-1', 'lxc/101')?.ips).toEqual(['10.0.0.6'])
    expect(() => deleteGuestIpEntry('missing', 'qemu/1')).not.toThrow()
  })

  it('bumps the generation of every invalidated connection', () => {
    setGuestIpIndex('conn-1', new Map())
    setGuestIpIndex('conn-2', new Map())

    expect(getGuestIpGeneration('conn-1')).toBe(0)
    invalidateGuestIpIndex('conn-1')
    expect(getGuestIpGeneration('conn-1')).toBe(1)
    expect(getGuestIpGeneration('conn-2')).toBe(0)

    invalidateGuestIpIndex()
    expect(getGuestIpGeneration('conn-2')).toBe(1)
    expect(getGuestIpIndex('conn-1')).toBeNull()
  })
})
