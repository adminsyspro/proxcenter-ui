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
    expect(ALL_SCOPE_IDS).toHaveLength(7)
  })

  it('does not offer compliance:read (#632)', () => {
    // It mapped to admin.compliance, which also authorises the five
    // compliance mutations. Nothing in the allowlist ever required it, so
    // the scope granted exactly nothing while promising a read — and it
    // would have turned into a live write grant the day any compliance
    // route joined the allowlist.
    expect(SCOPE_DEFINITIONS['compliance:read']).toBeUndefined()
    expect(ALL_SCOPE_IDS).not.toContain('compliance:read')
    expect(expandScopes(['compliance:read'])).toEqual(new Set())
  })

  it('every resolved key already exists in ALL_PERMISSIONS (seeded catalogue)', () => {
    const known = new Set(ALL_PERMISSIONS.map(p => p.id))
    for (const keys of Object.values(SCOPE_DEFINITIONS)) {
      for (const key of keys) expect(known.has(key)).toBe(true)
    }
  })

  // The guard that closes the whole class, not just the compliance:read
  // instance (#632). A token is read-only by construction (405 on any
  // non-GET, allowlist entries are all GET), so a scope carrying a
  // write-capable permission is always a naming lie — and one that goes
  // live silently as soon as an unrelated change allowlists a route that
  // checks it. Fail here instead, at the moment the scope is written.
  it('never bundles a dangerous or write-capable permission', () => {
    const catalogue = new Map(ALL_PERMISSIONS.map(p => [p.id, p]))
    const READ_SUFFIXES = ['.view', '.content']

    for (const [scope, keys] of Object.entries(SCOPE_DEFINITIONS)) {
      for (const key of keys) {
        const entry = catalogue.get(key)

        expect(entry, `scope ${scope} maps to unknown permission ${key}`).toBeDefined()
        expect(
          Boolean(entry && (entry as { isDangerous?: boolean }).isDangerous),
          `scope ${scope} maps to ${key}, which is flagged isDangerous in the catalogue`,
        ).toBe(false)
        expect(
          READ_SUFFIXES.some(suffix => key.endsWith(suffix)),
          `scope ${scope} maps to ${key}, which is not a read permission (expected a ${READ_SUFFIXES.join(' or ')} suffix)`,
        ).toBe(true)
      }
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
