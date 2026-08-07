import { describe, it, expect } from 'vitest'

import {
  buildScopeOptions,
  resolveScopeTargetLabel,
  formatScopeTarget,
  buildVdcScopeOptions,
  buildVdcNameByPool,
} from './scope-options'

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

describe('buildVdcScopeOptions', () => {
  const vdcs = [
    { tenantId: 't1', pvePoolName: 'vdc-acme-paris', name: 'ACME — Paris', enabled: true },
    { tenantId: 't1', pvePoolName: 'vdc-acme-fra', name: 'ACME — Frankfurt', enabled: false },
    { tenantId: 't2', pvePoolName: 'vdc-beta-x', name: 'Beta — X', enabled: true },
  ]

  it('lists only the targeted tenant enabled vDCs, id = pvePoolName', () => {
    expect(buildVdcScopeOptions(vdcs, 't1')).toEqual([
      { id: 'vdc-acme-paris', label: 'ACME — Paris', sublabel: 'vdc-acme-paris', icon: 'ri-cloud-line' },
    ])
  })

  it('empty for a tenant without vDCs', () => {
    expect(buildVdcScopeOptions(vdcs, 't9')).toEqual([])
  })
})

describe('buildVdcNameByPool', () => {
  it('maps pvePoolName to the display name', () => {
    expect(buildVdcNameByPool([{ pvePoolName: 'vdc-acme-paris', name: 'ACME — Paris' }]).get('vdc-acme-paris'))
      .toBe('ACME — Paris')
  })
})
