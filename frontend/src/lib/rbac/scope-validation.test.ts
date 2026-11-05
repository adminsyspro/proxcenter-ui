import { describe, it, expect } from 'vitest'

import { scopeBreadth, scopeIncludes, validateAssignmentScope, validateRoleDefaultScopes } from './scope-validation'

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

describe('scopeIncludes', () => {
  const s = (scopeType: string, scopeTarget: string | null = null) => ({ scopeType, scopeTarget })

  it('global includes every scope', () => {
    expect(scopeIncludes(s('global'), s('node', 'c1:pve1'))).toBe(true)
    expect(scopeIncludes(s('global'), s('tag', 'db'))).toBe(true)
    expect(scopeIncludes(s('global'), s('inherit'))).toBe(true)
  })

  it('a connection includes its own nodes, guests and storages, nothing else', () => {
    expect(scopeIncludes(s('connection', 'c1'), s('node', 'c1:pve1'))).toBe(true)
    expect(scopeIncludes(s('connection', 'c1'), s('vm', 'c1:pve1:qemu:100'))).toBe(true)
    expect(scopeIncludes(s('connection', 'c1'), s('storage', 'c1:local'))).toBe(true)
    expect(scopeIncludes(s('connection', 'c1'), s('node', 'c2:pve1'))).toBe(false)
    expect(scopeIncludes(s('connection', 'c1'), s('connection', 'c10'))).toBe(false)
    expect(scopeIncludes(s('connection', 'c1'), s('tag', 'db'))).toBe(false)
    expect(scopeIncludes(s('connection', 'c1'), s('pool', 'prod'))).toBe(false)
    expect(scopeIncludes(s('connection', 'c1'), s('global'))).toBe(false)
  })

  it('a node includes its own guests only', () => {
    expect(scopeIncludes(s('node', 'c1:pve1'), s('vm', 'c1:pve1:qemu:100'))).toBe(true)
    expect(scopeIncludes(s('node', 'c1:pve1'), s('vm', 'c1:pve2:qemu:100'))).toBe(false)
    expect(scopeIncludes(s('node', 'c1:pve1'), s('node', 'c1:pve2'))).toBe(false)
    expect(scopeIncludes(s('node', 'c1:pve1'), s('node', 'c1:pve10'))).toBe(false)
    expect(scopeIncludes(s('node', 'c1:pve1'), s('storage', 'c1:pve1'))).toBe(false)
    expect(scopeIncludes(s('node', 'c1:pve1'), s('connection', 'c1'))).toBe(false)
  })

  it('an identical scope is included; a leaf or inherited scope includes only itself', () => {
    expect(scopeIncludes(s('vm', 'c1:pve1:qemu:100'), s('vm', 'c1:pve1:qemu:100'))).toBe(true)
    expect(scopeIncludes(s('vm', 'c1:pve1:qemu:100'), s('vm', 'c1:pve1:qemu:101'))).toBe(false)
    expect(scopeIncludes(s('tag', 'db'), s('tag', 'db'))).toBe(true)
    expect(scopeIncludes(s('tag', 'db'), s('vm', 'c1:pve1:qemu:100'))).toBe(false)
    expect(scopeIncludes(s('pool', 'prod'), s('pool', 'prod'))).toBe(true)
    expect(scopeIncludes(s('inherit'), s('inherit'))).toBe(true)
    expect(scopeIncludes(s('inherit'), s('connection', 'c1'))).toBe(false)
    expect(scopeIncludes(s('inherit'), s('global'))).toBe(false)
  })
})
