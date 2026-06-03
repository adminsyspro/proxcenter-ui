import { describe, it, expect } from 'vitest'
import { resolveEffectiveScopes } from './index'

// Pure resolution of an assignment's effective scopes. "inherit" follows the
// role's default scopes; any explicit scope overrides the role default.
describe('resolveEffectiveScopes', () => {
  it('inherit follows the role default scopes', () => {
    const roleDefaults = [
      { scopeType: 'tag', scopeTarget: 'db' },
      { scopeType: 'tag', scopeTarget: 'oracle' },
    ]
    expect(resolveEffectiveScopes('inherit', null, roleDefaults)).toEqual(roleDefaults)
  })

  it('inherit with an empty default list resolves to global', () => {
    expect(resolveEffectiveScopes('inherit', null, [])).toEqual([
      { scopeType: 'global', scopeTarget: null },
    ])
  })

  it('inherit with null/undefined defaults resolves to global', () => {
    expect(resolveEffectiveScopes('inherit', null, null)).toEqual([
      { scopeType: 'global', scopeTarget: null },
    ])
    expect(resolveEffectiveScopes('inherit', null, undefined)).toEqual([
      { scopeType: 'global', scopeTarget: null },
    ])
  })

  it('an explicit scope overrides the role default (ignores defaults)', () => {
    const roleDefaults = [{ scopeType: 'tag', scopeTarget: 'db' }]
    expect(resolveEffectiveScopes('tag', 'special', roleDefaults)).toEqual([
      { scopeType: 'tag', scopeTarget: 'special' },
    ])
  })

  it('explicit global resolves to a single global scope', () => {
    expect(resolveEffectiveScopes('global', null, [{ scopeType: 'tag', scopeTarget: 'db' }])).toEqual([
      { scopeType: 'global', scopeTarget: null },
    ])
  })

  it('preserves mixed scope types from the role default', () => {
    const roleDefaults = [
      { scopeType: 'tag', scopeTarget: 'db' },
      { scopeType: 'pool', scopeTarget: 'dbpool' },
      { scopeType: 'node', scopeTarget: 'conn1:n1' },
    ]
    expect(resolveEffectiveScopes('inherit', null, roleDefaults)).toEqual(roleDefaults)
  })

  it('ignores malformed default entries (missing scopeType)', () => {
    const roleDefaults = [
      { scopeType: 'tag', scopeTarget: 'db' },
      { scopeTarget: 'orphan' } as any,
      { scopeType: '', scopeTarget: 'blank' },
    ]
    expect(resolveEffectiveScopes('inherit', null, roleDefaults)).toEqual([
      { scopeType: 'tag', scopeTarget: 'db' },
    ])
  })
})
