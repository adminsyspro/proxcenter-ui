import { describe, it, expect } from 'vitest'

import {
  extractGroupsFromClaim,
  isLdapGroupAllowed,
  normalizeGroupRoleEntries,
  normalizeGroupRoleMapping,
  normalizeMappingStrategy,
  projectEntriesToRoleMapping,
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

/**
 * Issue #992: the mapping is stored as an ordered LIST, because jsonb re-sorts
 * an object's keys and the row order is what decides a user's role.
 */
describe('normalizeGroupRoleEntries', () => {
  it('returns an empty list for missing / null / unparseable inputs', () => {
    expect(normalizeGroupRoleEntries(undefined)).toEqual([])
    expect(normalizeGroupRoleEntries(null)).toEqual([])
    expect(normalizeGroupRoleEntries('')).toEqual([])
    expect(normalizeGroupRoleEntries('{not json')).toEqual([])
    expect(normalizeGroupRoleEntries(42)).toEqual([])
  })

  it('keeps the list order exactly as submitted', () => {
    const entries = [
      { group: 'zzz', role: 'role_admin' },
      { group: 'aaa', role: 'role_viewer' },
      { group: 'mmm', role: 'role_operator' },
    ]
    expect(normalizeGroupRoleEntries(entries)).toEqual(entries)
    expect(normalizeGroupRoleEntries(JSON.stringify(entries))).toEqual(entries)
  })

  it('reads a legacy flat object as one entry per key', () => {
    expect(normalizeGroupRoleEntries({ admins: 'role_admin', devs: 'role_operator' })).toEqual([
      { group: 'admins', role: 'role_admin' },
      { group: 'devs', role: 'role_operator' },
    ])
  })

  it('trims both sides and drops half-filled rows', () => {
    expect(
      normalizeGroupRoleEntries([
        { group: '  admins  ', role: '  role_admin  ' },
        { group: '', role: 'role_viewer' },
        { group: 'devs', role: '' },
        { group: 'ops' },
        'nonsense',
        null,
      ]),
    ).toEqual([{ group: 'admins', role: 'role_admin' }])
  })

  it('refuses a prototype-polluting group name', () => {
    expect(
      normalizeGroupRoleEntries([
        { group: '__proto__', role: 'role_admin' },
        { group: 'constructor', role: 'role_admin' },
        { group: 'admins', role: 'role_admin' },
      ]),
    ).toEqual([{ group: 'admins', role: 'role_admin' }])
  })
})

describe('projectEntriesToRoleMapping', () => {
  it('keeps the topmost entry of a repeated group', () => {
    expect(
      projectEntriesToRoleMapping([
        { group: 'admins', role: 'role_admin' },
        { group: 'admins', role: 'role_viewer' },
      ]),
    ).toEqual({ admins: 'role_admin' })
  })
})

describe('normalizeMappingStrategy', () => {
  it('accepts the two known strategies', () => {
    expect(normalizeMappingStrategy('first_match')).toBe('first_match')
    expect(normalizeMappingStrategy('cumulative')).toBe('cumulative')
    expect(normalizeMappingStrategy(' cumulative ')).toBe('cumulative')
  })

  it('falls back to first_match on anything else, including a null column', () => {
    expect(normalizeMappingStrategy(null)).toBe('first_match')
    expect(normalizeMappingStrategy(undefined)).toBe('first_match')
    expect(normalizeMappingStrategy('')).toBe('first_match')
    expect(normalizeMappingStrategy('union')).toBe('first_match')
    expect(normalizeMappingStrategy(7)).toBe('first_match')
  })
})
