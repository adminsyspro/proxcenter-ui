import { describe, it, expect } from 'vitest'

import { scopeBreadth, validateAssignmentScope, validateRoleDefaultScopes } from './scope-validation'

describe('validateAssignmentScope', () => {
  it('accepts global and inherit without a target', () => {
    expect(validateAssignmentScope('global', null)).toEqual({ ok: true, scopeType: 'global', scopeTarget: null })
    expect(validateAssignmentScope('inherit', null)).toEqual({ ok: true, scopeType: 'inherit', scopeTarget: null })
  })

  it('drops any target on global/inherit', () => {
    expect(validateAssignmentScope('inherit', 'x')).toEqual({ ok: true, scopeType: 'inherit', scopeTarget: null })
  })

  it('accepts a scoped type with a target', () => {
    expect(validateAssignmentScope('tag', 'db')).toEqual({ ok: true, scopeType: 'tag', scopeTarget: 'db' })
  })

  it('rejects a scoped type with no target', () => {
    expect(validateAssignmentScope('tag', null).ok).toBe(false)
    expect(validateAssignmentScope('pool', '').ok).toBe(false)
  })

  it('rejects an unknown scope type', () => {
    expect(validateAssignmentScope('bogus', 'x').ok).toBe(false)
  })
})

describe('validateRoleDefaultScopes', () => {
  it('accepts an empty list (clears the default scope)', () => {
    expect(validateRoleDefaultScopes([])).toEqual({ ok: true, scopes: [] })
  })

  it('normalizes valid entries to camelCase', () => {
    const r = validateRoleDefaultScopes([
      { scopeType: 'tag', scopeTarget: 'db' },
      { scope_type: 'pool', scope_target: 'dbpool' },
    ])
    expect(r).toEqual({
      ok: true,
      scopes: [
        { scopeType: 'tag', scopeTarget: 'db' },
        { scopeType: 'pool', scopeTarget: 'dbpool' },
      ],
    })
  })

  it('rejects non-array input', () => {
    expect(validateRoleDefaultScopes(null as any).ok).toBe(false)
    expect(validateRoleDefaultScopes({} as any).ok).toBe(false)
  })

  it('rejects global and inherit as role default scope types', () => {
    expect(validateRoleDefaultScopes([{ scopeType: 'global', scopeTarget: null }]).ok).toBe(false)
    expect(validateRoleDefaultScopes([{ scopeType: 'inherit', scopeTarget: null }]).ok).toBe(false)
  })

  it('rejects an entry with a missing target', () => {
    expect(validateRoleDefaultScopes([{ scopeType: 'tag', scopeTarget: '' }]).ok).toBe(false)
    expect(validateRoleDefaultScopes([{ scopeType: 'node' }]).ok).toBe(false)
  })

  it('rejects an unknown scope type', () => {
    expect(validateRoleDefaultScopes([{ scopeType: 'bogus', scopeTarget: 'x' }]).ok).toBe(false)
  })
})

describe('storage scope (issue #921)', () => {
  it('accepts a storage assignment with its connectionId:storageId target and refuses it bare', () => {
    expect(validateAssignmentScope('storage', 'conn-1:local')).toEqual({ ok: true, scopeType: 'storage', scopeTarget: 'conn-1:local' })
    expect(validateAssignmentScope('storage', null).ok).toBe(false)
  })

  it('accepts storage as a role default scope', () => {
    expect(validateRoleDefaultScopes([{ scopeType: 'storage', scopeTarget: 'conn-1:local' }])).toEqual({
      ok: true,
      scopes: [{ scopeType: 'storage', scopeTarget: 'conn-1:local' }],
    })
  })

  it('ranks a storage as narrow as a single VM', () => {
    expect(scopeBreadth('storage')).toBe(scopeBreadth('vm'))
    expect(scopeBreadth('storage')).toBeLessThan(scopeBreadth('node'))
  })
})
