import { describe, it, expect } from 'vitest'

import { buildScopeOptions, resolveScopeTargetLabel, formatScopeTarget } from './scope-options'

const t = (_k: string, _v?: any) => '' // sublabels not asserted here

const inventory = {
  clusters: [
    {
      id: 'c1',
      name: 'Cluster 1',
      status: 'online',
      nodes: [
        {
          node: 'n1',
          status: 'online',
          guests: [
            { type: 'qemu', vmid: 100, name: 'db1', tags: 'db;oracle', pool: 'dbpool' },
            { type: 'lxc', vmid: 101, name: 'web1', tags: 'web', pool: null },
          ],
        },
      ],
    },
  ],
}

describe('buildScopeOptions', () => {
  it('returns [] without inventory', () => {
    expect(buildScopeOptions(null, 'tag', t)).toEqual([])
    expect(buildScopeOptions({}, 'tag', t)).toEqual([])
  })

  it('extracts unique tags sorted', () => {
    const ids = buildScopeOptions(inventory, 'tag', t).map(o => o.id)
    expect(ids).toEqual(['db', 'oracle', 'web'])
  })

  it('extracts pools (only non-null)', () => {
    expect(buildScopeOptions(inventory, 'pool', t).map(o => o.id)).toEqual(['dbpool'])
  })

  it('builds node ids as connId:node', () => {
    expect(buildScopeOptions(inventory, 'node', t).map(o => o.id)).toEqual(['c1:n1'])
  })

  it('builds vm ids as connId:node:type:vmid', () => {
    expect(buildScopeOptions(inventory, 'vm', t).map(o => o.id)).toEqual([
      'c1:n1:qemu:100',
      'c1:n1:lxc:101',
    ])
  })

  it('builds connection options', () => {
    expect(buildScopeOptions(inventory, 'connection', t).map(o => o.id)).toEqual(['c1'])
  })

  it('returns [] for an unknown type', () => {
    expect(buildScopeOptions(inventory, 'bogus', t)).toEqual([])
  })
})

describe('resolveScopeTargetLabel', () => {
  it('resolves a connection id to its name', () => {
    expect(resolveScopeTargetLabel(inventory, 'connection', 'c1', t)).toBe('Cluster 1')
  })

  it('resolves a vm id to its name', () => {
    expect(resolveScopeTargetLabel(inventory, 'vm', 'c1:n1:qemu:100', t)).toBe('db1')
  })

  it('leaves tag/pool targets unchanged (already names)', () => {
    expect(resolveScopeTargetLabel(inventory, 'pool', 'dbpool', t)).toBe('dbpool')
    expect(resolveScopeTargetLabel(inventory, 'tag', 'db', t)).toBe('db')
  })

  it('falls back to the raw target when inventory is missing or the id is gone', () => {
    expect(resolveScopeTargetLabel(null, 'connection', 'c1', t)).toBe('c1')
    expect(resolveScopeTargetLabel(inventory, 'connection', 'ghost', t)).toBe('ghost')
  })
})

describe('formatScopeTarget', () => {
  const connNames = { c1: 'PROXMOX-PROD' }

  it('maps a connection id to its name (object or Map)', () => {
    expect(formatScopeTarget(connNames, 'connection', 'c1')).toBe('PROXMOX-PROD')
    expect(formatScopeTarget(new Map([['c1', 'PROXMOX-PROD']]), 'connection', 'c1')).toBe('PROXMOX-PROD')
  })

  it('formats node and vm composite ids', () => {
    expect(formatScopeTarget(connNames, 'node', 'c1:n1')).toBe('n1 · PROXMOX-PROD')
    expect(formatScopeTarget(connNames, 'vm', 'c1:n1:qemu:100')).toBe('qemu/100 · n1')
  })

  it('leaves tag/pool targets untouched and falls back on unknown connection', () => {
    expect(formatScopeTarget(connNames, 'pool', 'dbpool')).toBe('dbpool')
    expect(formatScopeTarget(connNames, 'connection', 'ghost')).toBe('ghost')
  })
})
