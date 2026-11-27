import { describe, it, expect } from 'vitest'
import { PERMISSIONS } from '@/lib/rbac'
import { ALL_PERMISSIONS, ROLES } from '@/../prisma/roleCatalogue'

describe('k8s permissions', () => {
  it('defines K8S_VIEW and K8S_MANAGE', () => {
    expect(PERMISSIONS.K8S_VIEW).toBe('k8s.view')
    expect(PERMISSIONS.K8S_MANAGE).toBe('k8s.manage')
  })
  it('registers both in the catalogue under the k8s category', () => {
    const ids = ALL_PERMISSIONS.filter(p => p.category === 'k8s').map(p => p.id)
    expect(ids).toEqual(expect.arrayContaining(['k8s.view', 'k8s.manage']))
    const manage = ALL_PERMISSIONS.find(p => p.id === 'k8s.manage')
    expect(manage?.isDangerous).toBe(true)
  })
  it('gives role_k8s_operator the manage permission', () => {
    const k8sOperator = ROLES.find(r => r.id === 'role_k8s_operator')
    expect(k8sOperator?.permissions).toContain('k8s.manage')
  })
})
