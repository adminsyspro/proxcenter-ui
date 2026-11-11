import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import {
  ceilingFromRoles,
  isAssignableFromDialog,
  isServiceDeskRole,
  publishedTenantOptions,
  toPublishable,
} from './catalogueClient'
import RevokeAssignmentsDialog from './RevokeAssignmentsDialog'
import RolePublicationEditor from './RolePublicationEditor'
import ServiceDeskEditDialog from './ServiceDeskEditDialog'
import ServiceDeskTargetEditor from './ServiceDeskTargetEditor'
import TenantCheckboxGrid from './TenantCheckboxGrid'

// Translate stub: the key, plus its values, so the assertions read the wiring.
const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k)
const TENANTS = [
  { id: 'default', name: 'Provider' },
  { id: 't1', name: 'Alpha' },
  { id: 't2', name: 'Beta' },
]

afterEach(() => cleanup())

describe('catalogueClient', () => {
  const sd = { id: 'r', name: 'SD', is_system: false, tenant_id: 'default', audience: 'service_desk', publish_all: false, published_tenants: ['t2'] }

  it('maps the wire role onto the shared rule', () => {
    expect(toPublishable(sd)).toEqual({ isSystem: false, tenantId: 'default', audience: 'service_desk', publishAll: false, publications: [{ tenantId: 't2' }] })
    expect(toPublishable({ id: 'x', name: 'x', is_system: true })).toEqual({ isSystem: true, tenantId: null, audience: null, publishAll: false, publications: [] })
  })

  it('tells what the dialog may offer', () => {
    expect(isServiceDeskRole(sd)).toBe(true)
    expect(isServiceDeskRole(null)).toBe(false)
    expect(isAssignableFromDialog({ ...sd, audience: 'tenant' }, 't2')).toBe(true)
    expect(isAssignableFromDialog({ ...sd, audience: 'tenant' }, 't1')).toBe(false)
  })

  it('lists the published tenants, every customer one when published to all', () => {
    expect(publishedTenantOptions(sd, TENANTS)).toEqual([{ id: 't2', name: 'Beta' }])
    expect(publishedTenantOptions({ ...sd, publish_all: true }, TENANTS)).toEqual([TENANTS[1], TENANTS[2]])
    expect(publishedTenantOptions(undefined, TENANTS)).toEqual([])
  })

  it('reads the ceiling from the Tenant Admin role when it is loaded', () => {
    expect(ceilingFromRoles([])).toBeNull()
    const ceiling = ceilingFromRoles([{ id: 'role_tenant_admin', name: 'TA', is_system: true, permissions: [{ id: 'vm.view', name: 'vm.view' }, { id: 'backup.view' }] }])
    expect(ceiling?.has('vm.view')).toBe(true)
    expect(ceiling?.has('backup.view')).toBe(true)
    expect(ceiling?.has('vm.config.nic.mac')).toBe(true)
  })
})

describe('TenantCheckboxGrid', () => {
  const tenants = TENANTS.slice(1)

  it('toggles one tenant and keeps the list order', () => {
    const onChange = vi.fn()
    renderWithProviders(<TenantCheckboxGrid tenants={tenants} value={['t2']} onChange={onChange} t={t} />)
    fireEvent.click(screen.getByLabelText('Alpha'))
    expect(onChange).toHaveBeenLastCalledWith(['t1', 't2'])
    fireEvent.click(screen.getByLabelText('Beta'))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('selects all, or clears all, from the three-state box', () => {
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(<TenantCheckboxGrid tenants={tenants} value={['t1']} onChange={onChange} t={t} />)
    const all = screen.getByLabelText('rbacPage.catalogue.allTenantsBox') as HTMLInputElement
    expect(all.getAttribute('data-indeterminate')).toBe('true')
    fireEvent.click(all)
    expect(onChange).toHaveBeenLastCalledWith(['t1', 't2'])
    rerender(<TenantCheckboxGrid tenants={tenants} value={['t1', 't2']} onChange={onChange} t={t} />)
    fireEvent.click(screen.getByLabelText('rbacPage.catalogue.allTenantsBox'))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('says so when there is no tenant', () => {
    renderWithProviders(<TenantCheckboxGrid tenants={[]} value={[]} onChange={vi.fn()} t={t} />)
    expect(screen.getByText('rbacPage.catalogue.noTenants')).toBeTruthy()
  })
})

describe('RolePublicationEditor', () => {
  const props = {
    onAudienceChange: vi.fn(),
    publishAll: false,
    onPublishAllChange: vi.fn(),
    tenantIds: [] as string[],
    onTenantIdsChange: vi.fn(),
    tenants: TENANTS,
    t,
  }

  it('shows the publication of a published audience, the provider tenant left out', () => {
    renderWithProviders(<RolePublicationEditor {...props} audience='tenant' />)
    expect(screen.getByText('rbacPage.catalogue.audienceTenantDesc')).toBeTruthy()
    expect(screen.getByLabelText('Alpha')).toBeTruthy()
    expect(screen.queryByLabelText('Provider')).toBeNull()
    fireEvent.click(screen.getByLabelText('rbacPage.catalogue.publishAll'))
    expect(props.onPublishAllChange).toHaveBeenCalledWith(true)
  })

  it('hides the tenants once published to all, and the whole publication for a provider role', () => {
    const { rerender } = renderWithProviders(<RolePublicationEditor {...props} audience='service_desk' publishAll />)
    expect(screen.queryByLabelText('Alpha')).toBeNull()
    rerender(<RolePublicationEditor {...props} audience='provider' />)
    expect(screen.queryByText('rbacPage.catalogue.publication')).toBeNull()
  })

  it('offers to keep a legacy role as is, and reports a chosen audience', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RolePublicationEditor {...props} audience={null} legacy />)
    expect(screen.getByText('rbacPage.catalogue.audienceLegacyDesc')).toBeTruthy()
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('rbacPage.catalogue.audienceLegacy', { selector: 'li *' })).toBeTruthy()
    await user.click(screen.getByText('rbacPage.catalogue.audienceServiceDesk'))
    expect(props.onAudienceChange).toHaveBeenCalledWith('service_desk')
  })
})

describe('RevokeAssignmentsDialog', () => {
  it('lists the tenants and confirms or cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderWithProviders(
      <RevokeAssignmentsDialog open roleName='SD L1' revoked={[{ tenant_id: 't1', tenant_name: 'Alpha', count: 3 }]} onCancel={onCancel} onConfirm={onConfirm} t={t} />,
    )
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('rbacPage.catalogue.revokeCount:{"count":3}')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'rbacPage.catalogue.revokeConfirm' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('ServiceDeskTargetEditor', () => {
  it('shows the tenants only when narrowing', () => {
    const onAll = vi.fn()
    const { rerender } = renderWithProviders(
      <ServiceDeskTargetEditor allTenants onAllTenantsChange={onAll} tenantIds={[]} onTenantIdsChange={vi.fn()} publishedTenants={TENANTS.slice(1)} t={t} />,
    )
    expect(screen.queryByLabelText('Alpha')).toBeNull()
    fireEvent.click(screen.getByLabelText('rbacPage.catalogue.serviceDeskTargetAll'))
    expect(onAll).toHaveBeenCalledWith(false)
    rerender(<ServiceDeskTargetEditor allTenants={false} onAllTenantsChange={onAll} tenantIds={['t1']} onTenantIdsChange={vi.fn()} publishedTenants={TENANTS.slice(1)} t={t} />)
    expect((screen.getByLabelText('Alpha') as HTMLInputElement).checked).toBe(true)
  })
})

describe('ServiceDeskEditDialog', () => {
  const assignment = {
    id: 'sda_1',
    user: { id: 'u', email: 'sd@x', name: null },
    role: { id: 'r', name: 'SD L1', color: null },
    all_tenants: false,
    tenant_ids: ['t1'],
    tenants: [{ id: 't1', name: 'Alpha' }],
    granted_at: '2026-11-10T00:00:00Z',
    granted_by_email: null,
    expires_at: null,
  }

  it('saves the new target and closes', async () => {
    let body: any = null
    server.use(http.patch('*/api/v1/rbac/service-desk-assignments/sda_1', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ data: {} })
    }))
    const onSaved = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<ServiceDeskEditDialog open assignment={assignment} publishedTenants={TENANTS.slice(1)} onClose={onClose} onSaved={onSaved} t={t} />)
    fireEvent.click(screen.getByLabelText('Beta'))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(body).toEqual({ all_tenants: false, tenant_ids: ['t1', 't2'] })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('needs a tenant when narrowing, and shows the server refusal', async () => {
    server.use(http.patch('*/api/v1/rbac/service-desk-assignments/sda_1', () => HttpResponse.json({ error: 'The role is not published to: t9' }, { status: 400 })))
    renderWithProviders(<ServiceDeskEditDialog open assignment={assignment} publishedTenants={TENANTS.slice(1)} onClose={vi.fn()} onSaved={vi.fn()} t={t} />)
    fireEvent.click(screen.getByLabelText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByText('rbacPage.catalogue.noTenantSelected')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Beta'))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByText('The role is not published to: t9')).toBeTruthy()
  })

  it('reports a network failure', async () => {
    server.use(http.patch('*/api/v1/rbac/service-desk-assignments/sda_1', () => HttpResponse.error()))
    renderWithProviders(<ServiceDeskEditDialog open assignment={{ ...assignment, all_tenants: true }} publishedTenants={[]} onClose={vi.fn()} onSaved={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByText('errors.connectionError')).toBeTruthy()
  })
})
