import { describe, it, expect } from 'vitest'

import {
  extractGroupsFromClaim,
  isLdapGroupAllowed,
  normalizeGroupRoleMapping,
  readGroupsClaim,
} from './groupMapping'

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

describe('extractGroupsFromClaim', () => {
  it('returns [] for non-array inputs', () => {
    expect(extractGroupsFromClaim(undefined)).toEqual([])
    expect(extractGroupsFromClaim(null)).toEqual([])
    expect(extractGroupsFromClaim('admin')).toEqual([])
    expect(extractGroupsFromClaim({ admin: true })).toEqual([])
  })

  it('returns the array unchanged when nothing needs trimming or dropping', () => {
    expect(extractGroupsFromClaim(['admin', 'ops'])).toEqual(['admin', 'ops'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(extractGroupsFromClaim([' admin ', '', '   ', 'ops'])).toEqual(['admin', 'ops'])
  })

  it('coerces non-string entries via String()', () => {
    expect(extractGroupsFromClaim(['admin', 42, null, 'ops'])).toEqual(['admin', '42', 'ops'])
  })
})

describe('isLdapGroupAllowed', () => {
  it('returns false when the allowed list is empty or missing', () => {
    expect(isLdapGroupAllowed(['admin'], [])).toBe(false)
    expect(isLdapGroupAllowed(['admin'], undefined)).toBe(false)
    expect(isLdapGroupAllowed(['admin'], null)).toBe(false)
  })

  it('returns false when the user has no groups', () => {
    expect(isLdapGroupAllowed([], ['admin'])).toBe(false)
    expect(isLdapGroupAllowed(undefined, ['admin'])).toBe(false)
    expect(isLdapGroupAllowed(null, ['admin'])).toBe(false)
  })

  it('matches by exact name', () => {
    expect(isLdapGroupAllowed(['admin', 'ops'], ['admin'])).toBe(true)
    expect(isLdapGroupAllowed(['user'], ['admin'])).toBe(false)
  })

  it('matches an allowed plain name against a user DN by extracting CN', () => {
    expect(isLdapGroupAllowed(['CN=admin,OU=Groups,DC=example,DC=com'], ['admin'])).toBe(true)
    expect(isLdapGroupAllowed(['CN=ops,OU=Groups,DC=example,DC=com'], ['admin'])).toBe(false)
  })

  it('trims whitespace on both sides', () => {
    expect(isLdapGroupAllowed([' admin '], [' admin '])).toBe(true)
    expect(isLdapGroupAllowed(['  '], ['admin'])).toBe(false)
    expect(isLdapGroupAllowed(['admin'], ['   '])).toBe(false)
  })

  it('trims the extracted CN before comparing', () => {
    expect(isLdapGroupAllowed(['CN= admin ,OU=Groups'], ['admin'])).toBe(true)
  })
})

describe('readGroupsClaim (issue #442)', () => {
  it('reports a real array claim as authoritative and extracts the groups', () => {
    expect(readGroupsClaim({ groups: [' admin ', '', 'ops'] }, 'groups'))
      .toEqual({ groups: ['admin', 'ops'], groupsClaimIsArray: true })
  })

  it('treats an empty array as authoritative (intended revoke)', () => {
    expect(readGroupsClaim({ groups: [] }, 'groups'))
      .toEqual({ groups: [], groupsClaimIsArray: true })
  })

  it('treats a missing groups claim as non-authoritative', () => {
    expect(readGroupsClaim({}, 'groups'))
      .toEqual({ groups: [], groupsClaimIsArray: false })
  })

  it('treats a non-array claim as non-authoritative', () => {
    expect(readGroupsClaim({ groups: 'admin' }, 'groups'))
      .toEqual({ groups: [], groupsClaimIsArray: false })
  })

  it('reads a custom claim key and falls back to "groups" when the key is unset', () => {
    expect(readGroupsClaim({ roles: ['ops'] }, 'roles'))
      .toEqual({ groups: ['ops'], groupsClaimIsArray: true })
    expect(readGroupsClaim({ groups: ['ops'] }, null))
      .toEqual({ groups: ['ops'], groupsClaimIsArray: true })
  })
})
