import { describe, expect, it } from 'vitest'

import { SCOPE_DEFINITIONS, ALL_SCOPE_IDS, expandScopes } from './scopes'
import { ALL_PERMISSIONS } from '../../../prisma/roleCatalogue'

describe('scope to permission resolver (spec section 7)', () => {
  it('each scope resolves to exactly its spec permission keys', () => {
    expect(SCOPE_DEFINITIONS['vms:read']).toEqual(['vm.view'])
    expect(SCOPE_DEFINITIONS['nodes:read']).toEqual(['node.view', 'connection.view'])
    expect(SCOPE_DEFINITIONS['storage:read']).toEqual(['storage.view', 'storage.content'])
    expect(SCOPE_DEFINITIONS['backups:read']).toEqual(['backup.view', 'backup.job.view'])
    expect(SCOPE_DEFINITIONS['automation:read']).toEqual(['automation.view'])
    expect(SCOPE_DEFINITIONS['alerts:read']).toEqual(['alerts.view', 'events.view'])
    expect(SCOPE_DEFINITIONS['reports:read']).toEqual(['reports.view'])
    expect(SCOPE_DEFINITIONS['compliance:read']).toEqual(['admin.compliance'])
    expect(ALL_SCOPE_IDS).toHaveLength(8)
  })

  it('every resolved key already exists in ALL_PERMISSIONS (seeded catalogue)', () => {
    const known = new Set(ALL_PERMISSIONS.map(p => p.id))
    for (const keys of Object.values(SCOPE_DEFINITIONS)) {
      for (const key of keys) expect(known.has(key)).toBe(true)
    }
  })

  it('expandScopes unions several scopes and ignores unknown scopes', () => {
    expect(expandScopes(['vms:read', 'nodes:read'])).toEqual(
      new Set(['vm.view', 'node.view', 'connection.view']),
    )
    expect(expandScopes(['bogus:scope'])).toEqual(new Set())
    expect(expandScopes([])).toEqual(new Set())
  })
})
