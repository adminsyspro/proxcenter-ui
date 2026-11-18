/**
 * useMicrosegAccess: the rights of a policy write and of a cluster write, for one cluster and for a shared policy, and
 * useMicrosegClusterWrite outside a provider (a page giving a plain MicrosegWriteContext).
 */

import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

import { MicrosegWriteContext, useMicrosegAccess, useMicrosegClusterWrite } from './microsegAccess'

function rbac(manage: string[], loading = false): RBACContextValue {
  return {
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading,
    hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true,
    hasPermissionOn: (permission: string, type: string, id: string) => permission === 'node.manage' && type === 'connection' && manage.includes(id),
    refresh: () => undefined,
  }
}

const access = (value: RBACContextValue, ids: string[]) => renderHook(() => useMicrosegAccess('c1', ids), {
  wrapper: ({ children }: { children: ReactNode }) => <RBACContext.Provider value={value}>{children}</RBACContext.Provider>,
}).result.current

describe('useMicrosegAccess', () => {
  it('keeps the rule of one cluster: its own right, and nothing disabled while the rights load', () => {
    expect(access(rbac(['c1']), ['c1'])).toMatchObject({ canWrite: true, everyCluster: false, canWriteSome: true })
    expect(access(rbac([]), [])).toMatchObject({ canWrite: false, everyCluster: false, canWriteSome: false })
    expect(access(rbac([], true), ['c1']).canWrite).toBe(true)
  })

  it('needs the right on every cluster of a shared policy for a policy write, on the cluster alone for a cluster write', () => {
    const one = access(rbac(['c1']), ['c1', 'c2'])
    expect(one).toMatchObject({ canWrite: false, everyCluster: true, canWriteSome: true })
    expect([one.canWriteOn('c1'), one.canWriteOn('c2'), one.canWriteOn('')]).toEqual([true, false, true])

    expect(access(rbac(['c1', 'c2']), ['c2', 'c1', 'c2'])).toMatchObject({ canWrite: true, everyCluster: false })
    // A cluster outside the user's scope: no right on it.
    expect(access(rbac(['c1', 'c2']), ['c1', 'c2', 'c9']).canWrite).toBe(false)
  })

  it('fails closed on a shared policy while the rights load', () => {
    const loading = access(rbac(['c1', 'c2'], true), ['c1', 'c2'])
    expect(loading).toMatchObject({ canWrite: false, canWriteSome: false })
    expect(loading.canWriteOn('c1')).toBe(false)
  })
})

describe('useMicrosegClusterWrite outside a provider', () => {
  it('follows the plain write context of the page', () => {
    const cluster = (value: boolean) => renderHook(() => useMicrosegClusterWrite(), {
      wrapper: ({ children }: { children: ReactNode }) => <MicrosegWriteContext.Provider value={value}>{children}</MicrosegWriteContext.Provider>,
    }).result.current
    expect(cluster(true).canWriteOn('c7')).toBe(true)
    expect(cluster(false)).toMatchObject({ canWriteSome: false })
    expect(cluster(false).canWriteOn('c1')).toBe(false)
  })
})
