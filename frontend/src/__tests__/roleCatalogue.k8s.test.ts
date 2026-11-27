import { describe, it, expect } from 'vitest'
import { ROLES } from '../../prisma/roleCatalogue'

describe('roleCatalogue k8s roles', () => {
  it('has dedicated k8s roles with correct permissions', () => {
    const v = ROLES.find(r => r.id === 'role_k8s_viewer')
    const o = ROLES.find(r => r.id === 'role_k8s_operator')
    expect(v?.permissions).toEqual(['k8s.view'])
    expect(o?.permissions).toEqual(['k8s.view', 'k8s.manage', 'k8s.provision'])
  })
})
