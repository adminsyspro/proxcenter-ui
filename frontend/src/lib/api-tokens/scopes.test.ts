import { describe, expect, it } from 'vitest'

import {
  SCOPE_DEFINITIONS,
  READ_SCOPE_DEFINITIONS,
  WRITE_SCOPE_DEFINITIONS,
  ALL_SCOPE_IDS,
  READ_SCOPE_IDS,
  WRITE_SCOPE_IDS,
  DESTRUCTIVE_SCOPE_IDS,
  isWriteScope,
  isCreatorCheckedScope,
  CREATOR_CHECKED_READ_SCOPE_IDS,
  expandScopes,
  ADMIN_WRITE_SCOPE_IDS, FLEET_SCOPE_IDS,
  readsAdminData,
} from './scopes'
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
    expect(SCOPE_DEFINITIONS['tenants:read']).toEqual(['admin.tenants.view'])
    expect(SCOPE_DEFINITIONS['vdcs:read']).toEqual(['admin.settings.view', 'vm.view', 'sdn.vnet.view'])
    expect(SCOPE_DEFINITIONS['ipam:read']).toEqual(['sdn.vnet.view'])
    expect(SCOPE_DEFINITIONS['rbac:read']).toEqual(['admin.rbac.view'])
    expect(SCOPE_DEFINITIONS['users:read']).toEqual(['admin.users.view'])
    expect(READ_SCOPE_IDS).toHaveLength(12)
    expect(Object.keys(READ_SCOPE_DEFINITIONS)).toEqual(READ_SCOPE_IDS)
  })

  it('offers 29 scopes: 12 read and 17 write', () => {
    expect(ALL_SCOPE_IDS).toHaveLength(29)
    expect(WRITE_SCOPE_IDS).toHaveLength(17)
    expect(ALL_SCOPE_IDS).toEqual([...READ_SCOPE_IDS, ...WRITE_SCOPE_IDS])
    expect(Object.keys(SCOPE_DEFINITIONS)).toEqual(ALL_SCOPE_IDS)
  })

  // Issue #1360: the admin reads are creator-checked like a write scope, and
  // map only the read-only children of the admin rights.
  it('checks the creator of exactly the admin read scopes, and of every write scope', () => {
    expect(CREATOR_CHECKED_READ_SCOPE_IDS).toEqual(['tenants:read', 'vdcs:read', 'ipam:read', 'rbac:read', 'users:read'])
    for (const id of CREATOR_CHECKED_READ_SCOPE_IDS) expect(isCreatorCheckedScope(id), id).toBe(true)
    for (const id of WRITE_SCOPE_IDS) expect(isCreatorCheckedScope(id), id).toBe(true)
    for (const id of ['vms:read', 'nodes:read', 'reports:read']) expect(isCreatorCheckedScope(id), id).toBe(false)
    expect(isCreatorCheckedScope('nope:read')).toBe(false)
    for (const id of CREATOR_CHECKED_READ_SCOPE_IDS) {
      for (const key of SCOPE_DEFINITIONS[id]) {
        if (key.startsWith('admin.')) expect(key, `${id} maps ${key}`).toMatch(/^admin\.[a-z]+\.view$/)
      }
    }
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
    for (const [scope, keys] of Object.entries(SCOPE_DEFINITIONS)) {
      for (const key of keys) expect(known.has(key), `scope ${scope} maps to unknown key ${key}`).toBe(true)
    }
  })

  // The guard that closes the whole class, not just the compliance:read
  // instance (#632). A token is read-only by construction (405 on any
  // non-GET, allowlist entries are all GET), so a scope carrying a
  // write-capable permission is always a naming lie — and one that goes
  // live silently as soon as an unrelated change allowlists a route that
  // checks it. Fail here instead, at the moment the scope is written.
  it('read scopes never bundle a dangerous or write-capable permission', () => {
    const catalogue = new Map(ALL_PERMISSIONS.map(p => [p.id, p]))
    const READ_SUFFIXES = ['.view', '.content']

    for (const [scope, keys] of Object.entries(READ_SCOPE_DEFINITIONS)) {
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

  it('write scopes carry exactly their spec permission keys', () => {
    expect(WRITE_SCOPE_DEFINITIONS).toEqual({
      'vms:power': ['vm.view', 'connection.view', 'vm.start', 'vm.stop', 'vm.restart', 'vm.suspend'],
      'vms:write': ['vm.view', 'connection.view', 'vm.create', 'vm.clone', 'vm.config'],
      'vms:snapshot': ['vm.view', 'connection.view', 'vm.snapshot'],
      'vms:migrate': ['vm.view', 'connection.view', 'vm.migrate'],
      'vms:delete': ['vm.view', 'connection.view', 'vm.delete'],
      'backups:write': [
        'backup.view', 'connection.view', 'backup.job.view', 'backup.job.create', 'backup.job.edit',
        'backup.job.delete', 'backup.job.run', 'vm.backup',
      ],
      'backups:restore': ['backup.view', 'connection.view', 'vm.backup', 'backup.restore'],
      'backups:delete': ['backup.view', 'connection.view', 'backup.delete'],
      'storage:write': [
        'storage.view', 'storage.content', 'storage.upload', 'storage.delete',
        'connection.view', 'connection.manage', 'backup.view',
      ],
      'ha:write': ['node.view', 'connection.view', 'node.manage', 'connection.manage'],
      'pools:write': ['connection.view', 'connection.manage'],
      'network:write': [
        'node.view', 'connection.view', 'node.network', 'connection.manage',
        'sdn.vnet.view', 'sdn.vnet.create', 'sdn.vnet.edit', 'sdn.vnet.delete',
      ],
      'firewall:write': ['node.view', 'connection.view', 'node.manage'],
      'vdcs:write': ['admin.settings.view', 'admin.settings.vdcs', 'vm.view', 'sdn.vnet.view'],
      'tenants:write': ['admin.tenants.view', 'admin.tenants'],
      'users:write': ['admin.users.view', 'admin.users'],
      'rbac:write': ['admin.rbac.view', 'admin.rbac'],
    })
  })

  it('write scopes never bundle automation, console or NIC mac/vlan keys, and admin keys only in the admin write scopes', () => {
    // The admin write scopes carry the admin right of their own domain and
    // its read-only child, nothing else: each needs a global grant and a
    // token not restricted to connections (issue #1360).
    const ADMIN_KEYS: Record<string, string[]> = {
      'vdcs:write': ['admin.settings.view', 'admin.settings.vdcs'],
      'tenants:write': ['admin.tenants.view', 'admin.tenants'],
      'users:write': ['admin.users.view', 'admin.users'],
      'rbac:write': ['admin.rbac.view', 'admin.rbac'],
    }
    expect(Object.keys(ADMIN_KEYS)).toEqual([...ADMIN_WRITE_SCOPE_IDS])
    const allowedAdmin = (scope: string, key: string) => (ADMIN_KEYS[scope] ?? []).includes(key)
    const forbidden = (key: string) =>
      key.startsWith('admin.') ||
      key.startsWith('automation.') ||
      key === 'vm.console' ||
      key === 'node.console' ||
      key === 'vm.config.nic.mac' ||
      key === 'vm.config.nic.vlan'

    for (const [scope, keys] of Object.entries(WRITE_SCOPE_DEFINITIONS)) {
      for (const key of keys) {
        expect(forbidden(key) && !allowedAdmin(scope, key), `write scope ${scope} bundles forbidden key ${key}`).toBe(false)
      }
    }
  })

  it('isWriteScope tells write scopes from read and unknown ones', () => {
    expect(isWriteScope('vms:read')).toBe(false)
    expect(isWriteScope('vms:write')).toBe(true)
    expect(isWriteScope('bogus:scope')).toBe(false)
    for (const id of WRITE_SCOPE_IDS) expect(isWriteScope(id)).toBe(true)
    for (const id of READ_SCOPE_IDS) expect(isWriteScope(id)).toBe(false)
  })

  it('flags the destructive scopes', () => {
    expect([...DESTRUCTIVE_SCOPE_IDS]).toEqual(['vms:delete', 'backups:delete'])
    for (const id of DESTRUCTIVE_SCOPE_IDS) expect(isWriteScope(id)).toBe(true)
  })

  it('expandScopes resolves write scopes', () => {
    expect(expandScopes(['vms:snapshot'])).toEqual(new Set(['vm.view', 'connection.view', 'vm.snapshot']))
  })

  it('the admin write scopes are the fleet scopes, and readsAdminData covers them with the admin read scopes', () => {
    expect([...ADMIN_WRITE_SCOPE_IDS]).toEqual(['vdcs:write', 'tenants:write', 'users:write', 'rbac:write'])
    expect([...FLEET_SCOPE_IDS]).toEqual([...ADMIN_WRITE_SCOPE_IDS])
    for (const id of ADMIN_WRITE_SCOPE_IDS) {
      expect(isWriteScope(id), id).toBe(true)
      expect(readsAdminData(id), id).toBe(true)
    }
    for (const id of CREATOR_CHECKED_READ_SCOPE_IDS) expect(readsAdminData(id)).toBe(true)
    expect(readsAdminData('network:write')).toBe(false)
    expect(readsAdminData('vms:read')).toBe(false)
  })
})
