/**
 * Settings > OIDC / SSO > Tenants (issue #1289): the tenant list, and the
 * connection form in tenant mode (locked tenant, tenant roles only, allowed
 * domains instead of the e-mail linking switches, its own callback URL).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import OidcConnectionForm from '../OidcConfigTab'
import TenantOidcConnectionsList from './TenantOidcConnectionsList'

const API = '/api/v1/auth/oidc/connections/t_acme'

let putBody: any = null
let rolesFetched = false

function mockFetch(routes: Record<string, unknown>) {
  putBody = null
  rolesFetched = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/v1/rbac/roles')) {
        rolesFetched = true
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      if (init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: routes[String(url)] }), { status: 200 })
    }),
  )
}

const tenantConfig = (over: Record<string, unknown> = {}) => ({
  tenant_id: 't_acme',
  configured: true,
  enabled: true,
  provider_name: 'Acme SSO',
  issuer_url: 'https://idp.acme.example',
  client_id: 'pxc',
  default_role: 'role_tenant_viewer',
  allowed_domains: ['acme.example'],
  group_role_mapping: JSON.stringify([{ group: 'ops', tenant: 't_acme', vdc: '', role: 'role_tenant_operator' }]),
  tenants: [{ id: 't_acme', name: 'Acme', slug: 'acme' }],
  vdcs: [],
  roles: [
    { id: 'role_tenant_viewer', name: 'Tenant Viewer', is_system: false },
    { id: 'role_tenant_operator', name: 'Tenant Operator', is_system: false },
  ],
  callback_url: 'https://pxc.example.com/api/auth/callback/oidc-t_acme',
  login_url: 'https://pxc.example.com/login/acme',
  ...over,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TenantOidcConnectionsList', () => {
  it('shows one row per tenant with the state of its IdP, and opens it', async () => {
    mockFetch({
      '/api/v1/auth/oidc/connections': [
        { tenant_id: 't_acme', name: 'Acme', configured: true, enabled: true, tenant_enabled: true, provider_name: 'Acme SSO' },
        { tenant_id: 't_beta', name: 'Beta', configured: false, enabled: false, tenant_enabled: true },
      ],
    })
    const onOpen = vi.fn()
    renderWithProviders(<TenantOidcConnectionsList onOpen={onOpen} />)

    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Acme SSO')).toBeTruthy()
    fireEvent.click(screen.getByText('Beta'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't_beta' }))
  })
})

describe('OidcConnectionForm in tenant mode', () => {
  it('shows the tenant callback and login URLs, not the provider ones', async () => {
    mockFetch({ [API]: tenantConfig() })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} showProxy={false} />)

    expect(await screen.findByText(/api\/auth\/callback\/oidc-t_acme/)).toBeTruthy()
    expect(screen.getAllByText(/\/login\/acme/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/api\/auth\/callback\/oidc$/)).toBeNull()
  })

  it('uses the tenant roles it was served, never the full role list', async () => {
    mockFetch({ [API]: tenantConfig() })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} showProxy={false} />)
    await screen.findByDisplayValue('ops')
    expect(rolesFetched).toBe(false)
  })

  it('saves to the tenant route with the allowed domains and the mapping locked to the tenant', async () => {
    mockFetch({ [API]: tenantConfig() })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} showProxy={false} />)

    const domains = await screen.findByDisplayValue('acme.example')
    fireEvent.change(domains, { target: { value: 'acme.example, acme.fr' } })
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer/i }))

    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody.allowed_domains).toBe('acme.example, acme.fr')
    expect(JSON.parse(putBody.group_role_mapping)).toEqual([{ group: 'ops', tenant: 't_acme', vdc: '', role: 'role_tenant_operator' }])
  })

  it('hides the e-mail linking switches and the outbound proxy', async () => {
    mockFetch({ [API]: tenantConfig() })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} showProxy={false} />)
    await screen.findByDisplayValue('ops')
    expect(screen.queryByText(/verified e-mail|e-mail vérifié/i)).toBeNull()
    expect(screen.queryByText(/outbound proxy|proxy sortant/i)).toBeNull()
  })
})

describe('TenantIdentityTab (issue #1289, lot 2)', () => {
  it('says the provider manages the IdP while self-service is closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'closed' }), { status: 403 })))
    const { default: TenantIdentityTab } = await import('./TenantIdentityTab')
    renderWithProviders(<TenantIdentityTab />)
    expect(await screen.findByText(/provider manages|fournisseur gère/i)).toBeTruthy()
  })

  it('shows its own connection form, without the outbound proxy, once open', async () => {
    mockFetch({ '/api/v1/tenant/identity': tenantConfig() })
    const { default: TenantIdentityTab } = await import('./TenantIdentityTab')
    renderWithProviders(<TenantIdentityTab />)
    expect(await screen.findByDisplayValue('ops')).toBeTruthy()
    expect(screen.queryByText(/outbound proxy|proxy sortant/i)).toBeNull()
  })

  it('shows the allowed domains read-only: the provider owns them', async () => {
    mockFetch({ '/api/v1/tenant/identity': tenantConfig() })
    const { default: TenantIdentityTab } = await import('./TenantIdentityTab')
    renderWithProviders(<TenantIdentityTab />)
    const domains = (await screen.findByDisplayValue('acme.example')) as HTMLInputElement
    expect(domains.disabled).toBe(true)
  })
})

describe('provider delegation switch', () => {
  it('sends self_service when the provider opens it', async () => {
    mockFetch({ [API]: tenantConfig({ self_service: false }) })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} canDelegate />)
    const toggle = await screen.findByRole('switch', { name: /let this tenant manage|laisser ce tenant/i })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer/i }))
    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody.self_service).toBe(true)
  })
})

describe('provider trust switch', () => {
  const trustSwitch = () => screen.findByRole('switch', { name: /trust this identity provider|faire confiance aux adresses/i })

  it('sends trusted_endpoints when the provider trusts the IdP it hosts', async () => {
    mockFetch({ [API]: tenantConfig({ self_service: false, trusted_endpoints: false }) })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} canDelegate />)
    fireEvent.click(await trustSwitch())
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer/i }))
    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody.trusted_endpoints).toBe(true)
  })

  it('is off and locked while the tenant manages its IdP: its addresses are always checked', async () => {
    mockFetch({ [API]: tenantConfig({ self_service: true, trusted_endpoints: true }) })
    renderWithProviders(<OidcConnectionForm mode='tenant' apiBase={API} canDelegate />)
    const toggle = (await trustSwitch()) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.checked).toBe(false)
  })

  it('is never offered to the tenant itself', async () => {
    mockFetch({ '/api/v1/tenant/identity': tenantConfig() })
    const { default: TenantIdentityTab } = await import('./TenantIdentityTab')
    renderWithProviders(<TenantIdentityTab />)
    expect(await screen.findByDisplayValue('ops')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: /trust this identity provider|faire confiance aux adresses/i })).toBeNull()
  })
})
