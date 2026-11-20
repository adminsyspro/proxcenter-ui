import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import en from '@/messages/en.json'
import ServiceAccountsPanel from './ServiceAccountsPanel'

const tokens = (en as any).settings.apiTokens
const t = tokens.serviceAccounts
const ACCOUNT = {
  id: 'sa-1', tenantId: 'acme', tenantName: 'Acme', name: 'ci-onboarding', description: null, enabled: true,
  roles: [{ id: 'a1', roleId: 'role_tenant_admin', roleName: 'Tenant Admin', color: null, scopeType: 'inherit' }],
  tokenCount: 1, lastUsedAt: null,
}

// The provider's view of GET /api/v1/rbac/roles: system roles, provider-only
// ones, a catalogue role published to acme, one published elsewhere, one kept
// for the provider, a service desk role and another tenant's own role.
const ROLES = [
  { id: 'role_super_admin', name: 'Super Admin', is_system: true, tenant_id: null },
  { id: 'role_provider_admin', name: 'Provider Admin', is_system: true, tenant_id: null },
  { id: 'role_vm_admin', name: 'VM Admin', is_system: true, tenant_id: null },
  { id: 'role_tenant_admin', name: 'Tenant Admin', is_system: true, tenant_id: null },
  { id: 'role_tenant_viewer', name: 'Tenant Viewer', is_system: true, tenant_id: null },
  { id: 'r_pub', name: 'Published to acme', is_system: false, tenant_id: 'default', audience: 'tenant', published_tenants: ['acme'] },
  { id: 'r_beta', name: 'Published to beta', is_system: false, tenant_id: 'default', audience: 'tenant', published_tenants: ['beta'] },
  { id: 'r_prov', name: 'Provider ops', is_system: false, tenant_id: 'default', audience: 'provider' },
  { id: 'r_desk', name: 'Service desk', is_system: false, tenant_id: 'default', audience: 'service_desk', publish_all: true },
  { id: 'r_own', name: 'Beta own', is_system: false, tenant_id: 'beta', audience: null },
]

let accounts: any[]
let rotateStatus = 200
let assignmentStatus = 201
const calls = () => vi.mocked(fetch).mock.calls.map(([u, i]: any) => `${i?.method ?? 'GET'} ${u}`)
const bodyOf = (method: string, url: string) => {
  const call = vi.mocked(fetch).mock.calls.find(([u, i]: any) => u === url && (i?.method ?? 'GET') === method)
  return call ? JSON.parse((call as any)[1].body) : undefined
}

beforeEach(() => {
  accounts = [ACCOUNT]
  rotateStatus = 200
  assignmentStatus = 201
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
    if (url === '/api/v1/service-accounts' && method === 'GET') return ok(accounts)
    if (url === '/api/v1/service-accounts' && method === 'POST') return ok({ id: 'sa-2' }, 201)
    if (url === '/api/v1/service-accounts/sa-1' && method === 'PATCH') return ok({ ...ACCOUNT, enabled: false })
    if (url === '/api/v1/service-accounts/sa-1/tokens' && method === 'GET') {
      return ok([{ id: 'tok-1', name: 'terraform', tokenPrefix: 'pxc_abcd1234', scopes: ['vms:read'], expiresAt: null, lastUsedAt: null }])
    }
    if (url === '/api/v1/service-accounts/sa-1/tokens/tok-1/rotate' && method === 'POST') {
      if (rotateStatus !== 200) return new Response(JSON.stringify({ error: 'refused' }), { status: rotateStatus })
      return ok({ token: { id: 'tok-1' }, secret: 'pxc_ROTATEDSECRET' })
    }
    if (url === '/api/v1/rbac/roles') return ok(ROLES)
    if (url === '/api/v1/rbac/assignments' && method === 'POST') {
      if (assignmentStatus !== 201) return new Response(JSON.stringify({ error: 'refused' }), { status: assignmentStatus })
      return ok({ id: 'a2' }, 201)
    }
    if (url === '/api/v1/rbac/assignments/a1' && method === 'DELETE') return ok({})
    if (url === '/api/v1/tenants') return ok([{ id: 'default', name: 'Provider', enabled: true }, { id: 'acme', name: 'Acme', enabled: true }])
    if (url === '/api/v1/admin/connections?type=pve') return ok([])
    if (url.startsWith('/api/v1/settings/api-tokens/grantable-scopes')) return ok({ grantable: [] })
    return new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

async function renderPanel() {
  const onTokensChanged = vi.fn()
  renderWithProviders(<ServiceAccountsPanel onTokensChanged={onTokensChanged} />)
  await screen.findByText('ci-onboarding')
  return onTokensChanged
}

describe('ServiceAccountsPanel', () => {
  it('shows one line per account: name, status, tenant, roles and token count', async () => {
    await renderPanel()
    const row = screen.getByText('ci-onboarding').closest('tr') as HTMLElement
    expect(within(row).getByText(t.enabled)).toBeInTheDocument()
    expect(within(row).getByText('Acme')).toBeInTheDocument()
    expect(within(row).getByText('Tenant Admin')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
  })

  it('says so when there is no account yet', async () => {
    accounts = []
    renderWithProviders(<ServiceAccountsPanel onTokensChanged={() => {}} />)
    expect(await screen.findByText(t.empty)).toBeInTheDocument()
  })

  it('shows the roles and tokens behind the chevron, a role removable there, with no inline role picker', async () => {
    const onTokensChanged = await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.details }))
    expect(await screen.findByText('terraform')).toBeInTheDocument()
    expect(screen.queryByLabelText(t.role)).toBeNull()

    await userEvent.click(screen.getByLabelText(t.removeRole))
    await waitFor(() => expect(calls()).toContain('DELETE /api/v1/rbac/assignments/a1'))
    expect(onTokensChanged).toHaveBeenCalled()
  })

  it('adds a role from the row action, in a dialog offering only the roles assignable in the account tenant', async () => {
    const onTokensChanged = await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.addRoleTitle }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t.addRoleDialogTitle.replace('{name}', 'ci-onboarding'))).toBeInTheDocument()
    expect(within(dialog).getByText(t.addRoleHelp)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: t.addRole })).toBeDisabled()

    await userEvent.click(within(dialog).getByLabelText(t.role))
    const options = (await screen.findAllByRole('option')).map(o => o.textContent)
    expect(options).toEqual(['Tenant Viewer', 'Published to acme'])
    await userEvent.click(screen.getByRole('option', { name: 'Tenant Viewer' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t.addRole }))
    await waitFor(() => expect(bodyOf('POST', '/api/v1/rbac/assignments')).toEqual({
      user_id: 'sa-1', role_id: 'role_tenant_viewer', scope_type: 'inherit', tenant_id: 'acme',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onTokensChanged).toHaveBeenCalled()
  })

  it('keeps the dialog open on a refused assignment, with the reason', async () => {
    assignmentStatus = 400
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.addRoleTitle }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText(t.role))
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant Viewer' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t.addRole }))
    expect(await within(dialog).findByText('refused')).toBeInTheDocument()
  })

  it('offers a provider account the provider roles, never super admin nor a role of a customer tenant', async () => {
    accounts = [{ ...ACCOUNT, tenantId: 'default', tenantName: 'Provider', roles: [] }]
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.addRoleTitle }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText(t.role))
    const options = (await screen.findAllByRole('option')).map(o => o.textContent)
    expect(options).toEqual(['Provider Admin', 'VM Admin', 'Tenant Admin', 'Tenant Viewer', 'Provider ops'])
  })

  it('creates an account in the chosen tenant', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.newAccount) }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${t.dialog.name}`)), 'tenant-ci')
    await waitFor(() => expect(within(dialog).getByLabelText(t.dialog.tenant)).toBeInTheDocument())
    await userEvent.click(within(dialog).getByRole('button', { name: t.dialog.create }))
    await waitFor(() => expect(bodyOf('POST', '/api/v1/service-accounts')).toEqual({ name: 'tenant-ci', tenantId: 'default' }))
  })

  it('asks before disabling, then disables', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.disable }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t.disableConfirm.replace('{name}', 'ci-onboarding'))).toBeInTheDocument()
    expect(calls()).not.toContain('PATCH /api/v1/service-accounts/sa-1')
    await userEvent.click(within(dialog).getByRole('button', { name: t.disable }))
    await waitFor(() => expect(bodyOf('PATCH', '/api/v1/service-accounts/sa-1')).toEqual({ enabled: false }))
  })

  it('opens the token dialog for the account', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.newToken }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText((en as any).settings.apiTokens.dialog.titleForAccount.replace('{name}', 'ci-onboarding'))).toBeInTheDocument()
  })
  it('rotates a token of the account after confirmation and shows the new secret once', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: t.details }))
    await screen.findByText('terraform')
    await userEvent.click(screen.getByRole('button', { name: tokens.rotate }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t.rotateTokenConfirm)).toBeInTheDocument()
    expect(calls()).not.toContain('POST /api/v1/service-accounts/sa-1/tokens/tok-1/rotate')

    await userEvent.click(within(dialog).getByRole('button', { name: tokens.rotate }))
    expect(await screen.findByText('pxc_ROTATEDSECRET')).toBeInTheDocument()
    expect(calls()).toContain('POST /api/v1/service-accounts/sa-1/tokens/tok-1/rotate')
    await userEvent.click(screen.getByRole('button', { name: tokens.reveal.done }))
    await waitFor(() => expect(screen.queryByText('pxc_ROTATEDSECRET')).not.toBeInTheDocument())
  })

  it.each([[400, 'rotateUnheld', 'serviceAccounts'], [403, 'rotateForbidden', 'tokens'], [500, 'rotateError', 'tokens']] as const)(
    'explains a refused rotation (%i) and shows no secret', async (status, key, ns) => {
      rotateStatus = status
      await renderPanel()
      await userEvent.click(screen.getByRole('button', { name: t.details }))
      await screen.findByText('terraform')
      await userEvent.click(screen.getByRole('button', { name: tokens.rotate }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: tokens.rotate }))
      expect(await screen.findByText((ns === 'tokens' ? tokens : t)[key])).toBeInTheDocument()
      expect(screen.queryByText('pxc_ROTATEDSECRET')).not.toBeInTheDocument()
    })
})
