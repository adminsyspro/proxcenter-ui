import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import TenantsTab from './TenantsTab'

const TENANT = {
  id: 't1', slug: 'acme', name: 'Acme Corp', description: null, enabled: 1,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', operatingModel: 'iaas',
}

const member = (id: string, name: string, extra: Record<string, unknown>) => ({
  id, name, email: `${id}@x.test`, role: 'user', enabled: 1, is_default: 0, is_super_admin: false,
  rbac_roles: [], joined_at: '2026-01-01T00:00:00Z', ...extra,
})

function stubFetch(members: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const data = url === '/api/v1/tenants' ? [TENANT] : url.endsWith('/users') && url.includes('/tenants/') ? members : []
    return { ok: true, status: 200, json: async () => ({ data }) }
  }))
}

async function openMembers() {
  renderWithProviders(<TenantsTab />)
  const edit = await screen.findByRole('button', { name: 'Edit' })
  fireEvent.click(edit)
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TenantsTab: member role chips (roadmap#65)', () => {
  it('shows Super Admin for a super admin whose legacy role is "user", never the legacy role', async () => {
    stubFetch([member('u1', 'Alice', { is_super_admin: true, role: 'user' })])
    await openMembers()

    expect(await screen.findByText('Super Admin')).toBeTruthy()
    expect(screen.queryByText('user')).toBeNull()
  })

  it('shows the RBAC role names of a regular member, system roles translated and custom ones verbatim', async () => {
    stubFetch([member('u2', 'Bob', {
      role: 'admin',
      rbac_roles: [
        { id: 'role_tenant_admin', name: 'raw-admin-name', is_system: true },
        { id: 'role_custom', name: 'Operators', is_system: false },
      ],
    })])
    await openMembers()

    expect(await screen.findByText('Operators')).toBeTruthy()
    expect(screen.getByText('Tenant Admin')).toBeTruthy()
    expect(screen.queryByText('raw-admin-name')).toBeNull()
    expect(screen.queryByText('admin')).toBeNull()
  })

  it('shows the no-role placeholder when the member holds no RBAC role', async () => {
    stubFetch([member('u3', 'Carol', { role: 'admin' })])
    await openMembers()

    await waitFor(() => expect(screen.getByText('Carol')).toBeTruthy())
    expect(screen.queryByText('admin')).toBeNull()
    expect(screen.getByText('No role in this tenant')).toBeTruthy()
  })
})
