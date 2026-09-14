import { describe, it, expect } from 'vitest'

import { INFRA_SCOPE_TYPES, hasInfraScope, showsClusterLevel } from './scopeKinds'

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

describe('showsClusterLevel', () => {
  const call = (over: Partial<Parameters<typeof showsClusterLevel>[0]> = {}) =>
    showsClusterLevel({ isFullClusterView: true, scopeTypes: ['global'], isSuperAdmin: false, ...over })

  it('groups nodes under their cluster for a global-scoped user on the provider tenant', () => {
    // The regression this fixes: a Viewer / Provider Admin / Operator used to
    // get a flat host list while the header above counted "2 clusters".
    expect(call()).toBe(true)
  })

  it('groups them for a connection- or node-scoped user too', () => {
    expect(call({ scopeTypes: ['connection'] })).toBe(true)
    expect(call({ scopeTypes: ['node'] })).toBe(true)
  })

  it('keeps the flat view for a pool, tag or vm scoped user', () => {
    expect(call({ scopeTypes: ['pool'] })).toBe(false)
    expect(call({ scopeTypes: ['tag'] })).toBe(false)
    expect(call({ scopeTypes: ['vm'] })).toBe(false)
  })

  it('never reveals the cluster inside a vDC tenant, whatever the scope', () => {
    // The vDC abstraction is the point: an infra scope must not punch through it.
    expect(call({ isFullClusterView: false, scopeTypes: ['global'] })).toBe(false)
    expect(call({ isFullClusterView: false, scopeTypes: ['connection'] })).toBe(false)
  })

  it('keeps the grouped view for a super-admin everywhere, as before', () => {
    expect(call({ isSuperAdmin: true, isFullClusterView: false, scopeTypes: [] })).toBe(true)
  })

  it('stays flat while the scope list has not loaded yet', () => {
    expect(call({ scopeTypes: undefined })).toBe(false)
    expect(call({ scopeTypes: [] })).toBe(false)
  })
})
