/**
 * The tenant / vDC columns of the OIDC group mapping, and the URLs an admin has
 * to register at the provider. Both are new contracts of the settings tab, and
 * both are easy to break from the save path without any type error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import OidcConfigTab from './OidcConfigTab'

const TENANTS = [
  { id: 'default', name: 'Provider', slug: 'default' },
  { id: 't_acme', name: 'Acme', slug: 'acme' },
]
const VDCS = [{ id: 'vdc_prod', tenantId: 't_acme', name: 'Acme Prod', slug: 'prod' }]
const ROLES = [
  { id: 'role_viewer', name: 'Viewer', is_system: false },
  { id: 'role_operator', name: 'Operator', is_system: false },
]

let putBody: any = null

function mockFetch(config: Record<string, unknown>) {
  putBody = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/v1/rbac/roles')) {
        return new Response(JSON.stringify({ data: ROLES }), { status: 200 })
      }
      if (init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: config }), { status: 200 })
    }),
  )
}

const baseConfig = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  provider_name: 'Keycloak',
  issuer_url: 'https://idp.example.com',
  client_id: 'proxcenter',
  scopes: 'openid profile email',
  claim_email: 'email',
  claim_name: 'name',
  claim_groups: 'groups',
  auto_provision: true,
  default_role: 'role_viewer',
  show_local_login: true,
  force_sso_redirect: false,
  hasClientSecret: true,
  app_origin: 'https://pxc.example.com',
  tenants: TENANTS,
  vdcs: VDCS,
  group_role_mapping: '[]',
  ...over,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OidcConfigTab — tenant / vDC group mapping', () => {
  it('renders a saved entry with its tenant and vDC selected', async () => {
    mockFetch(
      baseConfig({
        group_role_mapping: JSON.stringify([
          { group: 'ops-acme', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_operator' },
        ]),
      }),
    )
    renderWithProviders(<OidcConfigTab />)

    expect(await screen.findByDisplayValue('ops-acme')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeTruthy()
      expect(screen.getByText('Acme Prod')).toBeTruthy()
    })
  })

  it('shows "whole tenant" rather than an empty box for an unscoped entry', async () => {
    // A blank Select is indistinguishable from "not filled in yet", which is
    // why the vDC picker renders its empty option explicitly.
    mockFetch(
      baseConfig({
        group_role_mapping: JSON.stringify([{ group: 'admins', tenant: 'default', vdc: '', role: 'role_viewer' }]),
      }),
    )
    renderWithProviders(<OidcConfigTab />)

    expect(await screen.findByDisplayValue('admins')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Whole tenant')).toBeTruthy())
  })

  it('reads a legacy flat mapping as a provider-tenant entry', async () => {
    mockFetch(baseConfig({ group_role_mapping: JSON.stringify({ admins: 'role_operator' }) }))
    renderWithProviders(<OidcConfigTab />)

    expect(await screen.findByDisplayValue('admins')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Provider')).toBeTruthy())
  })

  it('hides the tenant and vDC pickers on a single-tenant install with no vDC', async () => {
    mockFetch(
      baseConfig({
        tenants: [TENANTS[0]],
        vdcs: [],
        group_role_mapping: JSON.stringify([{ group: 'admins', tenant: 'default', vdc: '', role: 'role_viewer' }]),
      }),
    )
    renderWithProviders(<OidcConfigTab />)

    expect(await screen.findByDisplayValue('admins')).toBeTruthy()
    expect(screen.queryByText('Whole tenant')).toBeNull()
  })

  it('saves the entry list, dropping a row with no group name', async () => {
    mockFetch(
      baseConfig({
        group_role_mapping: JSON.stringify([
          { group: 'ops-acme', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_operator' },
          { group: '   ', tenant: 'default', vdc: '', role: 'role_viewer' },
        ]),
      }),
    )
    renderWithProviders(<OidcConfigTab />)

    await screen.findByDisplayValue('ops-acme')
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(putBody).not.toBeNull())
    expect(JSON.parse(putBody.group_role_mapping)).toEqual([
      { group: 'ops-acme', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_operator' },
    ])
  })

  it('prints the callback and post-logout URLs from the origin the server serves', async () => {
    // Not window.location: the post-logout URL must be the one we actually send
    // to the provider, which follows NEXTAUTH_URL.
    mockFetch(baseConfig())
    renderWithProviders(<OidcConfigTab />)

    // Anchored, and matched on the whole line: an unanchored URL pattern would
    // also pass on https://evil.test/?x=https://pxc.example.com/login, which is
    // exactly what CodeQL's missing-regexp-anchor rule is there to catch.
    await waitFor(() => {
      expect(
        screen.getByText(/^Redirect \/ callback URL : https:\/\/pxc\.example\.com\/api\/auth\/callback\/oidc$/),
      ).toBeTruthy()
      expect(
        screen.getByText(/^Post-logout redirect URL : https:\/\/pxc\.example\.com\/login$/),
      ).toBeTruthy()
    })
  })
})
