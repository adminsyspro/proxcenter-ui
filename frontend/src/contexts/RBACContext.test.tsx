import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ tenantId: 'default' }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'same-user', tenantId: auth.tenantId } } }) }))
import { RBACProvider, useRBAC } from './RBACContext'

function CurrentAccess() {
  const { loading, hasPermission } = useRBAC()
  return <span>{loading ? 'loading' : hasPermission('vm.config.nic.mac') ? 'allowed' : 'denied'}</span>
}
function App() { return <RBACProvider><CurrentAccess /></RBACProvider> }
const response = (permissions: string[]) => ({ ok: true, json: async () => ({ data: { permissions } }) })

describe('tenant-bound effective permissions', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  beforeEach(() => { auth.tenantId = 'default'; vi.restoreAllMocks() })
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
