/**
 * Tenant / vDC aware group mapping: parsing and legacy projection.
 */
import { describe, it, expect } from 'vitest'

import { normalizeGroupGrantMapping, projectGrantsToRoleMapping } from './groupMapping'

describe('normalizeGroupGrantMapping', () => {
  it('reads the entry-list shape, filling the tenant and vDC defaults', () => {
    expect(
      normalizeGroupGrantMapping([
        { group: 'ops', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_operator' },
        { group: 'viewers', role: 'role_viewer' },
      ]),
    ).toEqual([
      { group: 'ops', tenantId: 't_acme', vdcId: 'vdc_prod', role: 'role_operator' },
      { group: 'viewers', tenantId: 'default', vdcId: null, role: 'role_viewer' },
    ])
  })

  it('accepts the internal key names as well as the wire ones', () => {
    expect(
      normalizeGroupGrantMapping([
        { group: 'ops', tenantId: 't_acme', vdcId: 'vdc_prod', role: 'role_operator' },
      ]),
    ).toEqual([{ group: 'ops', tenantId: 't_acme', vdcId: 'vdc_prod', role: 'role_operator' }])
  })

  it('reads a JSON string, as posted by the config form', () => {
    const json = JSON.stringify([{ group: 'ops', tenant: 't_acme', role: 'role_operator' }])
    expect(normalizeGroupGrantMapping(json)).toEqual([
      { group: 'ops', tenantId: 't_acme', vdcId: null, role: 'role_operator' },
    ])
  })

  it('translates a legacy flat object into provider-tenant, unscoped grants', () => {
    // This is the no-migration path: a config written before v1.5 is still a
    // { group: role } object in the JSONB column.
    expect(normalizeGroupGrantMapping({ admins: 'role_admin', ops: 'ops' })).toEqual([
      { group: 'admins', tenantId: 'default', vdcId: null, role: 'role_admin' },
      { group: 'ops', tenantId: 'default', vdcId: null, role: 'ops' },
    ])
  })

  it('trims group names so a value pasted from the IdP still matches at login', () => {
    expect(normalizeGroupGrantMapping([{ group: '  ops  ', role: '  role_operator  ' }])).toEqual([
      { group: 'ops', tenantId: 'default', vdcId: null, role: 'role_operator' },
    ])
  })

  it('drops half-filled rows rather than saving them as a grant', () => {
    expect(
      normalizeGroupGrantMapping([
        { group: '', role: 'role_operator' },
        { group: 'ops', role: '' },
        { group: '   ', role: '   ' },
        'not-an-object',
        null,
      ]),
    ).toEqual([])
  })

  it('refuses a prototype-polluting group name', () => {
    expect(normalizeGroupGrantMapping([{ group: '__proto__', role: 'role_admin' }])).toEqual([])
  })

  it('returns an empty list on malformed JSON instead of throwing', () => {
    expect(normalizeGroupGrantMapping('{not json')).toEqual([])
    expect(normalizeGroupGrantMapping(undefined)).toEqual([])
  })

  it('treats an empty vDC string as "the whole tenant"', () => {
    expect(normalizeGroupGrantMapping([{ group: 'ops', tenant: 't_acme', vdc: '', role: 'role_operator' }])).toEqual([
      { group: 'ops', tenantId: 't_acme', vdcId: null, role: 'role_operator' },
    ])
  })
})

describe('projectGrantsToRoleMapping', () => {
  it('keeps only the unscoped provider-tenant grants', () => {
    const grants = normalizeGroupGrantMapping([
      { group: 'admins', role: 'role_admin' },
      { group: 'ops', tenant: 't_acme', role: 'role_operator' },
      { group: 'dbas', vdc: 'vdc_prod', role: 'role_db' },
    ])
    expect({ ...projectGrantsToRoleMapping(grants) }).toEqual({ admins: 'role_admin' })
  })

  it('keeps the first grant when a group appears twice in the provider tenant', () => {
    const grants = normalizeGroupGrantMapping([
      { group: 'ops', role: 'role_operator' },
      { group: 'ops', role: 'role_viewer' },
    ])
    expect({ ...projectGrantsToRoleMapping(grants) }).toEqual({ ops: 'role_operator' })
  })

  it('projects a tenant-only mapping to an empty object', () => {
    const grants = normalizeGroupGrantMapping([{ group: 'ops', tenant: 't_acme', role: 'role_operator' }])
    expect({ ...projectGrantsToRoleMapping(grants) }).toEqual({})
  })
})
