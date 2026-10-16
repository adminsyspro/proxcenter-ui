import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

const tenantState = { isProvider: false }
const hasPermissionMock = vi.fn<(p: string) => boolean>(() => true)

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: tenantState.isProvider, currentTenant: { id: tenantState.isProvider ? 'default' : 'tenant-1' }, loading: false }),
}))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: (p: string) => hasPermissionMock(p), isAdmin: false, permissions: [] }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('./CreateBlueprintDialog', () => ({ default: () => null }))

import BlueprintsTab from './BlueprintsTab'

const hw = { cores: 2, sockets: 1, memory: 2048, diskSize: '20G' }
const rows = [
  { id: 'own', name: 'my recipe', imageSlug: 'debian-12', hardware: hw, tags: 'web;prod', ownedByCaller: true, createdAt: '2026-10-01T00:00:00Z' },
  { id: 'prov', name: 'provider recipe', imageSlug: 'custom-golden', hardware: JSON.stringify({ ...hw, memory: 512 }), ownedByCaller: false, isShared: false, grants: { tenantIds: ['tenant-1'], vdcIds: [] }, createdAt: '2026-10-02T00:00:00Z' },
  { id: 'shared', name: 'shared recipe', imageSlug: 'ubuntu', hardware: 'not json', ownedByCaller: true, isShared: true, createdAt: '2026-10-03T00:00:00Z' },
]

function stubFetch(data: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })))
}

const rowOf = (name: string) => screen.getByText(name).closest('[role="row"]') as HTMLElement

beforeEach(() => {
  tenantState.isProvider = false
  hasPermissionMock.mockReset().mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BlueprintsTab visibility (#903)', () => {
  it('marks the provider recipes a tenant sees, and only lets it edit its own', async () => {
    stubFetch(rows)
    renderWithProviders(<BlueprintsTab />)
    await waitFor(() => expect(screen.getByText('provider recipe')).toBeInTheDocument())

    expect(within(rowOf('provider recipe')).getByText('From the provider')).toBeInTheDocument()
    expect(within(rowOf('my recipe')).queryByText('From the provider')).toBeNull()
    expect(within(rowOf('provider recipe')).queryByLabelText('Edit')).toBeNull()
    expect(within(rowOf('my recipe')).getByLabelText('Edit')).toBeInTheDocument()
    expect(within(rowOf('my recipe')).getByLabelText('Delete')).toBeInTheDocument()
  })

  it('shows the provider who sees each recipe', async () => {
    tenantState.isProvider = true
    stubFetch(rows)
    renderWithProviders(<BlueprintsTab />)
    await waitFor(() => expect(screen.getByText('provider recipe')).toBeInTheDocument())

    expect(within(rowOf('provider recipe')).getByText('1 tenant')).toBeInTheDocument()
    expect(within(rowOf('shared recipe')).getByText('All tenants')).toBeInTheDocument()
    expect(within(rowOf('my recipe')).getByText('Private')).toBeInTheDocument()
  })

  it('reads the hardware as an object or as the older string shape, and ignores garbage', async () => {
    stubFetch(rows)
    renderWithProviders(<BlueprintsTab />)
    await waitFor(() => expect(screen.getByText('provider recipe')).toBeInTheDocument())

    expect(within(rowOf('my recipe')).getByText(/2C \/ 2GB \/ 20G/)).toBeInTheDocument()
    expect(within(rowOf('provider recipe')).getByText(/2C \/ 512MB \/ 20G/)).toBeInTheDocument()
    expect(within(rowOf('shared recipe')).queryByText(/C \//)).toBeNull()
  })

  it('hides edit and delete without vm.create', async () => {
    hasPermissionMock.mockReturnValue(false)
    stubFetch(rows)
    renderWithProviders(<BlueprintsTab />)
    await waitFor(() => expect(screen.getByText('my recipe')).toBeInTheDocument())
    expect(within(rowOf('my recipe')).queryByLabelText('Edit')).toBeNull()
  })
})
