import { describe, expect, it } from 'vitest'

import { grantCoversResource, hasGrantOn, storageResourceId } from './clientScope'

const grants = [
  { name: 'storage.upload', scope_type: 'storage', scope_target: 'c1:local' },
  { name: 'storage.content', scope_type: 'node', scope_target: 'c1:pve1' },
  { name: 'backup.job.create', scope_type: 'connection', scope_target: 'c2' },
  { name: 'vm.config', scope_type: 'global', scope_target: null },
  { name: 'vm.view', scope_type: 'pool', scope_target: 'prod' },
]

describe('hasGrantOn (client mirror of scopeMatches, #921)', () => {
  it('a storage grant answers for the storage it names only', () => {
    expect(hasGrantOn(grants, 'storage.upload', 'storage', storageResourceId('c1', 'local'))).toBe(true)
    expect(hasGrantOn(grants, 'storage.upload', 'storage', 'c1:ISO')).toBe(false)
    expect(hasGrantOn(grants, 'storage.upload', 'storage', 'c2:local')).toBe(false)
    expect(hasGrantOn(grants, 'storage.delete', 'storage', 'c1:local')).toBe(false)
  })

  it('a connection grant covers every storage of that connection, a node grant covers none', () => {
    expect(hasGrantOn(grants, 'backup.job.create', 'storage', 'c2:pbs')).toBe(true)
    expect(hasGrantOn(grants, 'backup.job.create', 'storage', 'c1:pbs')).toBe(false)
    expect(hasGrantOn(grants, 'storage.content', 'storage', 'c1:local')).toBe(false)
    expect(hasGrantOn(grants, 'storage.content', 'node', 'c1:pve1')).toBe(true)
  })

  it('a global grant covers everything and a parent right covers its ordinary children', () => {
    expect(hasGrantOn(grants, 'vm.config', 'storage', 'c9:x')).toBe(true)
    expect(hasGrantOn(grants, 'vm.config.media', 'vm', 'c9:n:qemu:1')).toBe(true)
    expect(hasGrantOn(grants, 'vm.config.nic.mac', 'vm', 'c9:n:qemu:1')).toBe(false)
  })

  it('tag and pool grants never match a resource on the client', () => {
    expect(hasGrantOn(grants, 'vm.view', 'vm', 'c1:pve1:qemu:100')).toBe(false)
  })

  it('fails closed on missing input', () => {
    expect(hasGrantOn(null, 'storage.upload', 'storage', 'c1:local')).toBe(false)
    expect(hasGrantOn(grants, 'storage.upload', 'storage', '')).toBe(false)
    expect(grantCoversResource({ scope_type: 'storage', scope_target: null }, 'storage', 'c1:local')).toBe(false)
    expect(grantCoversResource({ scope_type: 'bogus', scope_target: 'c1' }, 'storage', 'c1:local')).toBe(false)
  })

  it('a node named like a storage does not open the storage', () => {
    expect(grantCoversResource({ scope_type: 'node', scope_target: 'c1:backup' }, 'storage', 'c1:backup')).toBe(false)
    expect(grantCoversResource({ scope_type: 'node', scope_target: 'c1:backup' }, 'node', 'c1:backup')).toBe(true)
  })

  it('a storage named like a node does not open the node', () => {
    expect(grantCoversResource({ scope_type: 'storage', scope_target: 'c1:pve1' }, 'node', 'c1:pve1')).toBe(false)
    expect(grantCoversResource({ scope_type: 'vm', scope_target: 'c1:pve1' }, 'node', 'c1:pve1')).toBe(false)
  })
})
