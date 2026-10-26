import { describe, it, expect } from 'vitest'

import {
  buildTagPolicy, canChangeTag, changedTags, findTagDenial, parseTagAccessConfig, policyNeedsGuestTags, splitTags,
  type TagAccessConfig,
} from './tagAccess'

const config = (over: Partial<TagAccessConfig> = {}): TagAccessConfig => ({
  userAllow: 'free', allowList: [], registered: [], ...over,
})

describe('splitTags', () => {
  it('splits on PVE separators and drops empties', () => {
    expect(splitTags('a;b, c  d;;')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('accepts the array form GET /cluster/options returns', () => {
    expect(splitTags(['a', 'b;c'])).toEqual(['a', 'b', 'c'])
  })

  it('treats null and undefined as no tags', () => {
    expect(splitTags(null)).toEqual([])
    expect(splitTags(undefined)).toEqual([])
  })
})

describe('parseTagAccessConfig', () => {
  it('reads the object form PVE answers with', () => {
    expect(parseTagAccessConfig({
      'user-tag-access': { 'user-allow': 'list', 'user-allow-list': ['ok-1', 'ok-2'] },
      'registered-tags': ['reg'],
    })).toEqual({ userAllow: 'list', allowList: ['ok-1', 'ok-2'], registered: ['reg'] })
  })

  it('reads the property-string form', () => {
    expect(parseTagAccessConfig({
      'user-tag-access': 'user-allow=existing,user-allow-list=a;b',
      'registered-tags': 'r1;r2',
    })).toEqual({ userAllow: 'existing', allowList: ['a', 'b'], registered: ['r1', 'r2'] })
  })

  it('defaults to free with nothing set, like PVE', () => {
    expect(parseTagAccessConfig({})).toEqual(config())
    expect(parseTagAccessConfig(null)).toEqual(config())
  })

  it('falls back to free on an unknown mode', () => {
    expect(parseTagAccessConfig({ 'user-tag-access': { 'user-allow': 'bogus' } }).userAllow).toBe('free')
  })
})

describe('buildTagPolicy (get_allowed_tags)', () => {
  const guestTags = ['web', 'db', 'reg']

  it('free: guest tags and the allow-list, registered tags removed', () => {
    const p = buildTagPolicy(config({ allowList: ['extra'], registered: ['reg'] }), false, guestTags)
    expect([...p.allowed].sort((a, b) => a.localeCompare(b))).toEqual(['db', 'extra', 'web'])
    expect(p.freeform).toBe(true)
  })

  it('list: only the allow-list', () => {
    const p = buildTagPolicy(config({ userAllow: 'list', allowList: ['ok'] }), false, guestTags)
    expect([...p.allowed]).toEqual(['ok'])
    expect(p.freeform).toBe(false)
  })

  it('existing: allow-list plus the visible guest tags', () => {
    const p = buildTagPolicy(config({ userAllow: 'existing', allowList: ['ok'], registered: ['reg'] }), false, guestTags)
    expect([...p.allowed].sort((a, b) => a.localeCompare(b))).toEqual(['db', 'ok', 'web'])
  })

  it('none: nothing, not even the allow-list', () => {
    const p = buildTagPolicy(config({ userAllow: 'none', allowList: ['ok'] }), false, guestTags)
    expect(p.allowed.size).toBe(0)
  })

  it('privileged: everything, registered tags included', () => {
    const p = buildTagPolicy(config({ userAllow: 'none', allowList: ['ok'], registered: ['reg2'] }), true, guestTags)
    expect([...p.allowed].sort((a, b) => a.localeCompare(b))).toEqual(['db', 'ok', 'reg', 'reg2', 'web'])
  })

  it('keeps the visible guest tags apart from the allowed ones', () => {
    const p = buildTagPolicy(config({ userAllow: 'list' }), false, guestTags)
    expect([...p.guestTags].sort((a, b) => a.localeCompare(b))).toEqual(['db', 'reg', 'web'])
  })
})

describe('canChangeTag / findTagDenial (assert_tag_permissions)', () => {
  it('free lets any tag through except a registered one', () => {
    const p = buildTagPolicy(config({ registered: ['reg'] }), false, [])
    expect(canChangeTag(p, 'brand-new')).toBe(true)
    expect(findTagDenial(p, 'a', 'a;reg')).toEqual({ tag: 'reg', reason: 'registered' })
  })

  it('list refuses a tag outside the allow-list', () => {
    const p = buildTagPolicy(config({ userAllow: 'list', allowList: ['ok'] }), false, [])
    expect(findTagDenial(p, '', 'ok')).toBeNull()
    expect(findTagDenial(p, '', 'ok;other')).toEqual({ tag: 'other', reason: 'not-allowed' })
  })

  it('also checks removed tags, as PVE does', () => {
    const p = buildTagPolicy(config({ userAllow: 'list', allowList: ['ok'] }), false, [])
    expect(findTagDenial(p, 'ok;legacy', 'ok')).toEqual({ tag: 'legacy', reason: 'not-allowed' })
  })

  it('none refuses every change but not an unchanged value', () => {
    const p = buildTagPolicy(config({ userAllow: 'none' }), false, ['web'])
    expect(findTagDenial(p, 'web', 'web')).toBeNull()
    expect(findTagDenial(p, 'web', 'web;db')).toEqual({ tag: 'db', reason: 'not-allowed' })
    expect(findTagDenial(p, 'web', '')).toEqual({ tag: 'web', reason: 'not-allowed' })
  })

  it('a privileged user is never refused', () => {
    const p = buildTagPolicy(config({ userAllow: 'none', registered: ['reg'] }), true, [])
    expect(findTagDenial(p, '', 'reg;anything')).toBeNull()
  })
})

describe('changedTags', () => {
  it('ignores order and separators', () => {
    expect(changedTags('a;b', 'b,a')).toEqual([])
  })

  it('counts duplicates like PVE', () => {
    expect(changedTags('a', 'a;a')).toEqual(['a'])
  })

  it('lists added and removed tags', () => {
    expect(changedTags('a;b', 'b;c').sort((a, b) => a.localeCompare(b))).toEqual(['a', 'c'])
  })
})

describe('policyNeedsGuestTags', () => {
  it('only the existing mode needs them to decide, and never for a privileged user', () => {
    expect(policyNeedsGuestTags(config({ userAllow: 'existing' }), false)).toBe(true)
    expect(policyNeedsGuestTags(config({ userAllow: 'existing' }), true)).toBe(false)
    expect(policyNeedsGuestTags(config({ userAllow: 'list' }), false)).toBe(false)
    expect(policyNeedsGuestTags(config(), false)).toBe(false)
  })
})
