import { describe, it, expect } from 'vitest'

import { broadcastMessageSchema } from './schemas'
import { isSafeBannerLink } from './broadcast/links'

const valid = {
  message: 'Maintenance window Saturday 22:00 UTC 🛠️',
  bgColor: '#f59e0b',
  fgColor: '#000000',
  targetKind: 'all' as const,
}

describe('broadcastMessageSchema', () => {
  it('accepts a minimal all-users banner and applies defaults', () => {
    const parsed = broadcastMessageSchema.parse(valid)
    expect(parsed.dismissible).toBe(true)
    expect(parsed.enabled).toBe(true)
    expect(parsed.targetIds).toEqual([])
    expect(parsed.startsAt).toBeNull()
    expect(parsed.endsAt).toBeNull()
    expect(parsed.linkUrl).toBeNull()
  })

  it('keeps emoji in the message untouched', () => {
    expect(broadcastMessageSchema.parse(valid).message).toContain('🛠️')
  })

  it('trims the message and rejects a blank one', () => {
    expect(broadcastMessageSchema.parse({ ...valid, message: '  hello  ' }).message).toBe('hello')
    expect(broadcastMessageSchema.safeParse({ ...valid, message: '   ' }).success).toBe(false)
  })

  it('rejects a message longer than 500 characters', () => {
    expect(broadcastMessageSchema.safeParse({ ...valid, message: 'x'.repeat(501) }).success).toBe(false)
  })

  it.each(['red', '#fff', '#12345g', '#1234567', ''])('rejects the invalid colour %s', colour => {
    expect(broadcastMessageSchema.safeParse({ ...valid, bgColor: colour }).success).toBe(false)
  })

  it('requires targetIds when the target is not "all"', () => {
    expect(broadcastMessageSchema.safeParse({ ...valid, targetKind: 'tenants' }).success).toBe(false)
    expect(
      broadcastMessageSchema.safeParse({ ...valid, targetKind: 'tenants', targetIds: ['t1'] }).success,
    ).toBe(true)
  })

  it('ignores targetIds when the target is "all"', () => {
    expect(broadcastMessageSchema.parse({ ...valid, targetIds: ['t1'] }).targetIds).toEqual([])
  })

  it('requires endsAt to be strictly after startsAt', () => {
    const startsAt = '2026-08-01T20:00:00.000Z'
    expect(broadcastMessageSchema.safeParse({ ...valid, startsAt, endsAt: startsAt }).success).toBe(false)
    expect(
      broadcastMessageSchema.safeParse({ ...valid, startsAt, endsAt: '2026-08-01T22:00:00.000Z' }).success,
    ).toBe(true)
  })

  it('requires a label when a link is provided', () => {
    expect(broadcastMessageSchema.safeParse({ ...valid, linkUrl: '/status' }).success).toBe(false)
    expect(
      broadcastMessageSchema.safeParse({ ...valid, linkUrl: '/status', linkLabel: 'Status page' }).success,
    ).toBe(true)
  })
})

describe('isSafeBannerLink', () => {
  it.each(['https://status.example.com', 'http://status.example.com/x?y=1', '/status', '/a/b'])(
    'accepts %s',
    value => expect(isSafeBannerLink(value)).toBe(true),
  )

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    'ftp://example.com',
    'status.example.com',
    '/status\nx',
  ])('rejects %s', value => expect(isSafeBannerLink(value)).toBe(false))
})
