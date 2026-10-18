/**
 * roadmap#38: the lookup diagnostic must name the step that refuses a user
 * (user filter, ambiguity, allowed groups), keep login eligibility apart from
 * role mapping, and say when a group is only held through nesting.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: (v: string) => v }))

import { evaluateLdapLookup, type LdapLookupResult, type LdapPolicyInput } from './ldapDiagnostic'

const ADMINS = 'cn=dcvCenter Admins,ou=groups,dc=r38,dc=lab'
const NESTED = 'cn=vc-ops-nested,ou=groups,dc=r38,dc=lab'

const policy = (over: Partial<LdapPolicyInput> = {}): LdapPolicyInput => ({
  requireGroup: false,
  allowedGroups: [],
  groupRoleMapping: [{ group: 'dcvCenter Admins', role: 'role_operator' }],
  defaultRole: 'role_viewer',
  ...over,
})

const user = (name: string, groups: string[]) => ({ dn: `uid=${name},ou=people,dc=r38,dc=lab`, email: `${name}@r38.lab`, name, groups })

const base = (over: Partial<LdapLookupResult>): LdapLookupResult => ({
  status: 'found',
  username_placeholder: true,
  match_count: 1,
  password_checked: false,
  ...over,
})

describe('evaluateLdapLookup', () => {
  it('a direct member found by the filter can sign in, with the mapped role', () => {
    const ev = evaluateLdapLookup(base({ user: user('alice', [ADMINS]) }), policy(), 'alice')
    expect(ev.blocker).toBeNull()
    expect(ev.role).toMatchObject({ roleId: 'role_operator', matchedGroup: 'dcvCenter Admins', defaultRoleId: 'role_viewer' })
    expect(ev.allowedGroup).toMatchObject({ enforced: false, allowed: null })
    expect(ev.hints).toEqual([])
  })

  it('a user the identity search finds but the filter does not is excluded by the filter', () => {
    const ev = evaluateLdapLookup(
      base({
        status: 'not_found', match_count: 0,
        identity: { filter: '(sAMAccountName=bob)', match_count: 1, user: user('bob', []) },
        filter_groups: [{ group: ADMINS, recursive: false, evaluated: true, direct: false }],
      }),
      policy(),
      'bob',
    )
    expect(ev.blocker).toBe('excluded_by_filter')
    expect(ev.subject?.name).toBe('bob')
    // Role mapping is still shown, but only as "if admitted": no row matches.
    expect(ev.role).toMatchObject({ roleId: null, matchedGroup: null })
    expect(ev.hints).not.toContain('nested_membership')
  })

  it('a nested member is named as such, for the filter and the mapping', () => {
    const ev = evaluateLdapLookup(
      base({
        status: 'not_found', match_count: 0,
        identity: { filter: '(sAMAccountName=carol)', match_count: 1, user: user('carol', [NESTED]) },
        filter_groups: [{ group: ADMINS, recursive: false, evaluated: true, direct: false, via: [NESTED, ADMINS] }],
        nested_groups: [{ group: ADMINS, via: NESTED }],
      }),
      policy(),
      'carol',
    )
    expect(ev.blocker).toBe('excluded_by_filter')
    expect(ev.role?.nestedOnly).toEqual(['dcvCenter Admins'])
    expect(ev.hints).toContain('nested_membership')
  })

  it('the allowed-group restriction refuses a user the filter admits, and says when nesting is the reason', () => {
    const ev = evaluateLdapLookup(
      base({ user: user('carol', [NESTED]), nested_groups: [{ group: ADMINS, via: NESTED }] }),
      policy({ requireGroup: true, allowedGroups: ['dcvCenter Admins'] }),
      'carol',
    )
    expect(ev.blocker).toBe('not_in_allowed_group')
    expect(ev.allowedGroup).toEqual({ enforced: true, allowed: false, nestedOnly: ['dcvCenter Admins'] })
    expect(ev.hints).toContain('nested_membership')
  })

  it('an allowed group held directly admits the user; no mapping row falls back to the default role', () => {
    const ev = evaluateLdapLookup(
      base({ user: user('alice', [ADMINS]) }),
      policy({ requireGroup: true, allowedGroups: [`CN=dcvCenter Admins, OU=Groups,DC=r38,DC=lab`, 'dcvCenter Admins'], groupRoleMapping: [], defaultRole: '' }),
      'alice',
    )
    expect(ev.blocker).toBeNull()
    expect(ev.allowedGroup?.allowed).toBe(true)
    expect(ev.role).toMatchObject({ roleId: null, defaultRoleId: 'role_viewer' })
  })

  it('a restriction switched on without any group does not apply, as at sign-in', () => {
    const ev = evaluateLdapLookup(base({ user: user('bob', []) }), policy({ requireGroup: true, allowedGroups: [] }), 'bob')
    expect(ev.blocker).toBeNull()
    expect(ev.allowedGroup?.enforced).toBe(false)
  })

  it('an absent user with a domain in the name gets the username format hint', () => {
    const ev = evaluateLdapLookup(
      base({ status: 'not_found', match_count: 0, identity: { filter: '(sAMAccountName=alice@r38.lab)', match_count: 0 } }),
      policy(),
      'alice@r38.lab',
    )
    expect(ev.blocker).toBe('not_found')
    expect(ev.subject).toBeNull()
    expect(ev.hints).toEqual(['username_format', 'base_dn_scope'])

    expect(evaluateLdapLookup(base({ status: 'not_found', match_count: 0 }), policy(), 'R38\\alice').hints).toContain('username_format')
    expect(evaluateLdapLookup(base({ status: 'not_found', match_count: 0 }), policy(), 'alice').hints).toEqual(['base_dn_scope'])
  })

  it('maps ambiguous, invalid filter and lookup errors to their blocker', () => {
    expect(evaluateLdapLookup(base({ status: 'ambiguous', match_count: 2, matches: ['a', 'b'] }), policy(), 'dup').blocker).toBe('ambiguous')
    const invalid = evaluateLdapLookup(base({ status: 'invalid_filter', username_placeholder: false, match_count: 0 }), policy(), 'x')
    expect(invalid.blocker).toBe('invalid_filter')
    expect(invalid.hints).toEqual([])
    expect(evaluateLdapLookup(base({ status: 'error', stage: 'bind', match_count: 0 }), policy(), 'x').blocker).toBe('lookup_error')
  })

  it('warns when the filter has no username placeholder', () => {
    const ev = evaluateLdapLookup(base({ username_placeholder: false, user: user('alice', [ADMINS]) }), policy(), 'anyone')
    expect(ev.hints).toContain('placeholder_missing')
  })
})
