import { describe, it, expect } from 'vitest'

import { INFRA_SCOPE_TYPES, hasInfraScope } from './scopeKinds'

describe('INFRA_SCOPE_TYPES', () => {
  it('is exactly the infrastructure-level scope kinds', () => {
    expect([...INFRA_SCOPE_TYPES].sort()).toEqual(['connection', 'global', 'node'])
  })
})

describe('hasInfraScope', () => {
  it('grants admins infra scope regardless of their scope types', () => {
    expect(hasInfraScope([], true)).toBe(true)
    expect(hasInfraScope(undefined, true)).toBe(true)
    expect(hasInfraScope(['vm'], true)).toBe(true)
  })

  it('treats a global scope as infra scope', () => {
    expect(hasInfraScope(['global'], false)).toBe(true)
  })

  it('treats a connection scope as infra scope', () => {
    expect(hasInfraScope(['connection'], false)).toBe(true)
  })

  it('treats a node scope as infra scope', () => {
    expect(hasInfraScope(['node'], false)).toBe(true)
  })

  it('returns true when any role carries an infra scope', () => {
    expect(hasInfraScope(['vm', 'tag', 'node'], false)).toBe(true)
  })

  it('returns false for VM-only scope (the restricted-customer case)', () => {
    expect(hasInfraScope(['vm'], false)).toBe(false)
  })

  it('returns false for tag-only or pool-only scopes', () => {
    expect(hasInfraScope(['tag'], false)).toBe(false)
    expect(hasInfraScope(['pool'], false)).toBe(false)
    expect(hasInfraScope(['tag', 'pool'], false)).toBe(false)
  })

  it('returns false when the user has no scopes at all', () => {
    expect(hasInfraScope([], false)).toBe(false)
    expect(hasInfraScope(undefined, false)).toBe(false)
    expect(hasInfraScope(null, false)).toBe(false)
  })
})
