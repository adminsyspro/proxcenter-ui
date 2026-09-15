/**
 * vDC half of a group mapping, translated into RBAC scope vocabulary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { loadVdcScopes, toProviderGrantRows, type VdcScope } from './vdcScope'

describe('loadVdcScopes', () => {
  it('resolves every referenced vDC in a single query, deduplicated', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'vdc_a', tenantId: 't_acme', pvePoolName: 'pool-acme' },
    ])
    const scopes = await loadVdcScopes({ vdc: { findMany } }, ['vdc_a', 'vdc_a'])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ['vdc_a'] } })
    expect(scopes.get('vdc_a')).toEqual({ tenantId: 't_acme', pvePoolName: 'pool-acme' })
  })

  it('does not query at all when no grant names a vDC', async () => {
    const findMany = vi.fn()
    expect((await loadVdcScopes({ vdc: { findMany } }, [])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('toProviderGrantRows', () => {
  const scopes = new Map<string, VdcScope>([
    ['vdc_prod', { tenantId: 't_acme', pvePoolName: 'pool-acme-prod' }],
  ])

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('keeps a tenant-wide grant on inherit so it follows the role default scope', () => {
    expect(
      toProviderGrantRows([{ tenantId: 't_acme', vdcId: null, roleId: 'role_operator' }], scopes),
    ).toEqual([
      { tenantId: 't_acme', roleId: 'role_operator', scopeType: 'inherit', scopeTarget: null },
    ])
  })

  it('turns a vDC grant into a pool scope on the vDC PVE pool', () => {
    expect(
      toProviderGrantRows([{ tenantId: 't_acme', vdcId: 'vdc_prod', roleId: 'role_operator' }], scopes),
    ).toEqual([
      { tenantId: 't_acme', roleId: 'role_operator', scopeType: 'pool', scopeTarget: 'pool-acme-prod' },
    ])
  })

  it('drops a grant naming a deleted vDC instead of widening it to the tenant', () => {
    // Widening would hand out MORE access than the mapping spells out, which is
    // the one outcome a stale entry must never produce.
    expect(
      toProviderGrantRows([{ tenantId: 't_acme', vdcId: 'vdc_gone', roleId: 'role_operator' }], scopes),
    ).toEqual([])
  })

  it('drops a grant whose vDC belongs to another tenant', () => {
    expect(
      toProviderGrantRows([{ tenantId: 't_other', vdcId: 'vdc_prod', roleId: 'role_operator' }], scopes),
    ).toEqual([])
  })

  it('keeps the valid grants of a mapping that also holds a stale one', () => {
    const rows = toProviderGrantRows(
      [
        { tenantId: 't_acme', vdcId: 'vdc_gone', roleId: 'role_operator' },
        { tenantId: 'default', vdcId: null, roleId: 'role_viewer' },
      ],
      scopes,
    )
    expect(rows).toEqual([
      { tenantId: 'default', roleId: 'role_viewer', scopeType: 'inherit', scopeTarget: null },
    ])
  })
})
