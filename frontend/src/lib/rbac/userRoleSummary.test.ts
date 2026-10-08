import { describe, expect, it } from 'vitest'

import { assignmentOrigin, summarizeUserRoles } from './userRoleSummary'

const role = (id: string, tenant: string, assignment: string) => ({
  id,
  name: id,
  tenant_id: tenant,
  assignment_id: assignment,
})

describe('assignmentOrigin', () => {
  it('reads the owner from the id prefix the sign-in sync writes', () => {
    expect(assignmentOrigin('oidc_abc')).toBe('oidc')
    expect(assignmentOrigin('ldap_abc')).toBe('ldap')
    expect(assignmentOrigin('assign_abc')).toBe('manual')
    expect(assignmentOrigin(null)).toBe('manual')
  })
})

describe('summarizeUserRoles', () => {
  it('treats several roles in one tenant as cumulated, not divergent (issue #1074)', () => {
    const summary = summarizeUserRoles([
      role('role_operator', 'default', 'oidc_1'),
      role('role_viewer', 'default', 'oidc_2'),
    ])

    expect(summary.distinctRoles.map(r => r.id)).toEqual(['role_operator', 'role_viewer'])
    expect(summary.divergentAcrossTenants).toBe(false)
    expect(summary.providerManagedBy).toBe('oidc')
    expect(summary.hasManualRow).toBe(false)
  })

  it('keeps the same cumulated set across tenants out of the divergence warning', () => {
    const summary = summarizeUserRoles([
      role('role_a', 't1', 'oidc_1'),
      role('role_b', 't1', 'oidc_2'),
      role('role_b', 't2', 'oidc_3'),
      role('role_a', 't2', 'oidc_4'),
    ])

    expect(summary.distinctRoles).toHaveLength(2)
    expect(summary.divergentAcrossTenants).toBe(false)
  })

  it('flags tenants holding different roles', () => {
    const summary = summarizeUserRoles([
      role('role_tenant_admin', 't1', 'assign_1'),
      role('role_tenant_viewer', 't2', 'assign_2'),
    ])

    expect(summary.divergentAcrossTenants).toBe(true)
    expect(summary.providerManagedBy).toBeNull()
    expect(summary.hasManualRow).toBe(true)
  })

  it('reports a provider row next to an admin row', () => {
    const summary = summarizeUserRoles([
      role('role_viewer', 'default', 'ldap_1'),
      role('role_operator', 'default', 'assign_1'),
    ])

    expect(summary.providerManagedBy).toBe('ldap')
    expect(summary.hasManualRow).toBe(true)
  })

  it('tolerates a missing or empty list', () => {
    expect(summarizeUserRoles(undefined).distinctRoles).toEqual([])
    expect(summarizeUserRoles([]).divergentAcrossTenants).toBe(false)
  })
})
