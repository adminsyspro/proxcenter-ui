import { describe, it, expect } from 'vitest'

import { normalizeGroupRoleMapping } from './groupMapping'

describe('normalizeGroupRoleMapping', () => {
  it('returns an empty object for missing / null / empty inputs', () => {
    expect(normalizeGroupRoleMapping(undefined)).toEqual({})
    expect(normalizeGroupRoleMapping(null)).toEqual({})
    expect(normalizeGroupRoleMapping('')).toEqual({})
    expect(normalizeGroupRoleMapping('{}')).toEqual({})
  })

  it('returns an empty object on malformed JSON instead of throwing', () => {
    expect(normalizeGroupRoleMapping('not-json')).toEqual({})
    expect(normalizeGroupRoleMapping('{"unterminated')).toEqual({})
  })

  it('parses a JSON-string payload', () => {
    expect(normalizeGroupRoleMapping('{"admin":"role_admin","ops":"role_ops"}'))
      .toEqual({ admin: 'role_admin', ops: 'role_ops' })
  })

  it('accepts an already-parsed object', () => {
    expect(normalizeGroupRoleMapping({ admin: 'role_admin' }))
      .toEqual({ admin: 'role_admin' })
  })

  it('trims leading and trailing whitespace on group names', () => {
    expect(normalizeGroupRoleMapping({ ' admin': 'role_admin', 'ops ': 'role_ops' }))
      .toEqual({ admin: 'role_admin', ops: 'role_ops' })
  })

  it('trims inside a JSON-string payload too', () => {
    expect(normalizeGroupRoleMapping('{" admin":"role_admin"}'))
      .toEqual({ admin: 'role_admin' })
  })

  it('drops entries whose key is empty after trim', () => {
    expect(normalizeGroupRoleMapping({ '   ': 'orphan', admin: 'role_admin' }))
      .toEqual({ admin: 'role_admin' })
    expect(normalizeGroupRoleMapping({ '': 'orphan' })).toEqual({})
  })

  it('collapses keys that differ only by surrounding whitespace (last wins)', () => {
    // Two keys (`admin` and ` admin`) trim to the same group; the JS
    // object iteration order keeps the last assignment, matching how
    // admins typically expect a paste-over edit to behave.
    const out = normalizeGroupRoleMapping({ admin: 'role_old', ' admin': 'role_new' })
    expect(out).toEqual({ admin: 'role_new' })
  })

  it('drops prototype-pollution keys', () => {
    // __proto__ / constructor / prototype must never make it through, even
    // when JSON.parse hands us a payload that includes them as own
    // properties. The result must also keep Object.prototype clean.
    const out = normalizeGroupRoleMapping('{"__proto__":"role_pwn","constructor":"role_pwn","prototype":"role_pwn","admin":"role_admin"}')
    expect(out.admin).toBe('role_admin')
    expect((out as any).__proto__).not.toBe('role_pwn')
    expect((out as any).constructor).not.toBe('role_pwn')
    expect((out as any).prototype).toBeUndefined()
    expect((Object.prototype as any).role_pwn).toBeUndefined()
  })
})
