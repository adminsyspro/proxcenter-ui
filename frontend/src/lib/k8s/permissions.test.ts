import { describe, it, expect } from 'vitest'
import { PERMISSIONS } from '@/lib/rbac'
import { ALL_PERMISSIONS, ROLES } from '@/../prisma/roleCatalogue'

describe('k8s permissions', () => {
  it('defines K8S_VIEW, K8S_MANAGE and K8S_PROVISION', () => {
    expect(PERMISSIONS.K8S_VIEW).toBe('k8s.view')
    expect(PERMISSIONS.K8S_MANAGE).toBe('k8s.manage')
    expect(PERMISSIONS.K8S_PROVISION).toBe('k8s.provision')
  })
  it('registers all three in the catalogue under the k8s category, the two that change things as dangerous', () => {
    const ids = ALL_PERMISSIONS.filter(p => p.category === 'k8s').map(p => p.id)
    expect(ids).toEqual(expect.arrayContaining(['k8s.view', 'k8s.manage', 'k8s.provision']))
    expect(ALL_PERMISSIONS.find(p => p.id === 'k8s.manage')?.isDangerous).toBe(true)
    expect(ALL_PERMISSIONS.find(p => p.id === 'k8s.provision')?.isDangerous).toBe(true)
  })
  it('gives role_k8s_operator the manage and provision permissions', () => {
    const k8sOperator = ROLES.find(r => r.id === 'role_k8s_operator')
    expect(k8sOperator?.permissions).toEqual(expect.arrayContaining(['k8s.manage', 'k8s.provision']))
  })
})
