import { describe, expect, it } from 'vitest'

import { BACKUP_TABLES, orderForInsert } from './tables'

describe('orderForInsert', () => {
  it('puts every parent before its children and ignores parents outside the set', () => {
    const refs = new Map<string, Set<string>>([
      ['vdc_vnets', new Set(['vdcs'])],
      ['vdcs', new Set(['tenants', 'provider_connections'])],
      ['provider_connections', new Set(['Connection'])],
      ['license_mappings', new Set(['Connection', 'licenses'])],
      ['users', new Set(['users'])],
    ])

    const order = orderForInsert(['vdc_vnets', 'users', 'vdcs', 'license_mappings', 'tenants', 'provider_connections', 'Connection'], refs)

    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b))
    before('vdcs', 'vdc_vnets')
    before('tenants', 'vdcs')
    before('provider_connections', 'vdcs')
    before('Connection', 'provider_connections')
    before('Connection', 'license_mappings')
    expect(order).not.toContain('licenses')
    expect(order).toHaveLength(7)
  })

  it('terminates on a reference cycle', () => {
    const refs = new Map([['a', new Set(['b'])], ['b', new Set(['a'])]])

    expect(orderForInsert(['a', 'b'], refs).sort()).toEqual(['a', 'b'])
  })
})

describe('BACKUP_TABLES', () => {
  it('lists each table once and never history, sessions or licences', () => {
    const names = BACKUP_TABLES.map(t => t.name)

    expect(new Set(names).size).toBe(names.length)
    for (const excluded of ['audit_logs', 'sessions', 'licenses', 'install_identities', 'rbac_permissions', 'alert_instances', 'vdc_usage_history']) {
      expect(names).not.toContain(excluded)
    }
  })

  it('keeps the HTTPS certificates but not the ACME runtime state', () => {
    const names = BACKUP_TABLES.map(t => t.name)

    expect(names).toContain('tls_certificates')
    for (const runtime of ['tls_acme_accounts', 'tls_acme_challenges', 'tls_renew_leases']) expect(names).not.toContain(runtime)
  })
})
