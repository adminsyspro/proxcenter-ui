import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderHook } from '@testing-library/react'

const auth = vi.hoisted(() => ({ tenantId: 'default', status: 'authenticated' }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: auth.status,
    data: auth.status === 'authenticated' ? { user: { id: 'same-user', tenantId: auth.tenantId } } : null,
  }),
}))
import { RBACProvider, useMenuPermission, useRBAC } from './RBACContext'

function CurrentAccess() {
  const { loading, hasPermission } = useRBAC()
  return <span>{loading ? 'loading' : hasPermission('vm.config.nic.mac') ? 'allowed' : 'denied'}</span>
}
function App() { return <RBACProvider><CurrentAccess /></RBACProvider> }
const response = (permissions: string[]) => ({ ok: true, json: async () => ({ data: { permissions } }) })

describe('tenant-bound effective permissions', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  beforeEach(() => { auth.tenantId = 'default'; auth.status = 'authenticated'; vi.restoreAllMocks() })
  it('revokes old permissions immediately and reloads for a different tenant with the same user', async () => {
    let resolveTenant!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(['vm.config.nic.mac'])).mockImplementationOnce(() => new Promise(resolve => { resolveTenant = resolve })))
    const view = render(<App />)
    await screen.findByText('allowed')
    auth.tenantId = 'tenant-a'
    view.rerender(<App />)
    expect(screen.queryByText('allowed')).not.toBeInTheDocument()
    await act(async () => resolveTenant(response([])))
    await screen.findByText('denied')
  })
  it('ignores an old tenant response arriving after the new tenant permissions', async () => {
    let resolveOld!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(response([])))
    const view = render(<App />)
    auth.tenantId = 'tenant-a'
    view.rerender(<App />)
    await screen.findByText('denied')
    await act(async () => resolveOld(response(['vm.config.nic.mac'])))
    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument())
  })
})

// Issue #921: resource-aware check over the grant details of /api/v1/rbac/effective.
function StorageAccess() {
  const { loading, hasPermissionOn, hasPermission } = useRBAC()
  if (loading) return <span>loading</span>
  return (
    <span>
      {hasPermission('storage.upload') ? 'flat:yes' : 'flat:no'} {hasPermissionOn('storage.upload', 'storage', 'c1:local') ? 'local:yes' : 'local:no'} {hasPermissionOn('storage.upload', 'storage', 'c1:ISO') ? 'ISO:yes' : 'ISO:no'}
    </span>
  )
}
describe('hasPermissionOn', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  it('answers per storage from the grant scopes while the flat check stays coarse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {
      permissions: ['storage.upload'],
      permission_details: [{ name: 'storage.upload', scope_type: 'storage', scope_target: 'c1:local' }],
    } }) }))
    render(<RBACProvider><StorageAccess /></RBACProvider>)
    await screen.findByText('flat:yes local:yes ISO:no')
  })
  it('a super admin passes every resource check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { permissions: [], is_super_admin: true } }) }))
    render(<RBACProvider><StorageAccess /></RBACProvider>)
    await screen.findByText('flat:yes local:yes ISO:yes')
  })
})

const wrapper = ({ children }: { children: React.ReactNode }) => <RBACProvider>{children}</RBACProvider>
const effective = (data: Record<string, unknown>) => ({ ok: true, json: async () => ({ data }) })

describe('permission checks', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  beforeEach(() => { auth.tenantId = 'default'; auth.status = 'authenticated' })

  it('exposes the effective permissions, roles, scopes and hidden widgets once loaded', async () => {
    const role = { id: 'role_viewer', name: 'Viewer', color: null, scope_type: 'global' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(effective({
      permissions: ['vm.view', 'node.view'], roles: [role], scope_types: ['global'], hidden_widgets: ['kpi-vms'],
    })))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.permissions).toEqual(['vm.view', 'node.view'])
    expect(result.current.roles).toEqual([role])
    expect(result.current.scopeTypes).toEqual(['global'])
    expect(result.current.hiddenWidgets).toEqual(['kpi-vms'])
    expect(result.current.isAdmin).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/v1/rbac/effective')
  })

  it('answers hasPermission, hasAnyPermission and hasAllPermissions from the list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(effective({ permissions: ['vm.view', 'node.view'] })))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasPermission('vm.view')).toBe(true)
    expect(result.current.hasPermission('vm.delete')).toBe(false)
    expect(result.current.hasAnyPermission(['vm.delete', 'node.view'])).toBe(true)
    expect(result.current.hasAnyPermission(['vm.delete'])).toBe(false)
    expect(result.current.hasAnyPermission([])).toBe(true)
    expect(result.current.hasAnyPermission(null)).toBe(true)
    expect(result.current.hasAllPermissions(['vm.view', 'node.view'])).toBe(true)
    expect(result.current.hasAllPermissions(['vm.view', 'vm.delete'])).toBe(false)
    expect(result.current.hasAllPermissions(undefined)).toBe(true)
  })

  it('lets a super admin pass every check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(effective({ permissions: [], is_super_admin: true })))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isAdmin).toBe(true)
    expect(result.current.hasPermission('anything')).toBe(true)
    expect(result.current.hasAnyPermission(['a'])).toBe(true)
    expect(result.current.hasAllPermissions(['a', 'b'])).toBe(true)
  })

  it('denies everything without calling the API when there is no session', async () => {
    auth.status = 'unauthenticated'
    vi.stubGlobal('fetch', vi.fn())
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.permissions).toEqual([])
    expect(result.current.hasPermission('vm.view')).toBe(false)
    expect(result.current.hasAnyPermission(['vm.view'])).toBe(false)
    expect(result.current.hasAllPermissions([])).toBe(false)
    expect(result.current.hasPermissionOn('storage.upload', 'storage', 'c1:local')).toBe(false)
  })

  it('denies everything and stops loading when the API answers an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasPermission('vm.view')).toBe(false)
    expect(error).toHaveBeenCalledWith('Failed to load RBAC permissions:', expect.any(Error))
  })

  it('keeps the previous state when the payload carries no data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.permissions).toEqual([])
    expect(result.current.hasPermissionOn('storage.upload', 'storage', 'c1:local')).toBe(false)
  })

  it('reloads the permissions on refresh', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(effective({ permissions: [] }))
      .mockResolvedValueOnce(effective({ permissions: ['vm.view'] })))
    const { result } = renderHook(() => useRBAC(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasPermission('vm.view')).toBe(false)
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.hasPermission('vm.view')).toBe(true))
  })
})

describe('useMenuPermission', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  beforeEach(() => { auth.tenantId = 'default'; auth.status = 'authenticated' })

  it('shows the item while loading, then follows the permissions', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(r => { resolve = r })))
    const { result } = renderHook(() => ({ vm: useMenuPermission(['vm.view']), node: useMenuPermission(['node.view']) }), { wrapper })
    expect(result.current).toEqual({ vm: true, node: true })
    await act(async () => resolve(effective({ permissions: ['vm.view'] })))
    await waitFor(() => expect(result.current).toEqual({ vm: true, node: false }))
  })

  it('shows an item that requires nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(effective({ permissions: [] })))
    const { result } = renderHook(() => ({ empty: useMenuPermission([]), none: useMenuPermission() }), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ empty: true, none: true }))
  })
})

describe('outside a provider', () => {
  it('falls back to a denying default context', () => {
    const { result } = renderHook(() => useRBAC())
    expect(result.current.loading).toBe(true)
    expect(result.current.hasPermission('vm.view')).toBe(false)
    expect(result.current.hasAnyPermission(['vm.view'])).toBe(false)
    expect(result.current.hasAllPermissions(['vm.view'])).toBe(false)
    expect(result.current.hasPermissionOn('vm.view', 'vm', 'x')).toBe(false)
    expect(result.current.refresh()).toBeUndefined()
  })
})
