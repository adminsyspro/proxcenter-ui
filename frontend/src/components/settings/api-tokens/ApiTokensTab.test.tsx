import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { useLicenseMock } = vi.hoisted(() => ({
  useLicenseMock: vi.fn(() => ({ hasFeature: () => true, loading: false })),
}))

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: useLicenseMock,
  Features: { API_ACCESS: 'api_access' },
}))

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import ApiTokensTab from './ApiTokensTab'
import en from '@/messages/en.json'

// Fix round 1, finding 2 (C3): a message bundle whose dialog.confirm is a
// sentinel no source literal would ever match. renderWithProviders always
// renders English regardless of `locale` (it hardcodes enMessages), so the
// earlier attempt of sourcing the expectation from en.json's own value could
// never distinguish t('dialog.confirm') from a hardcoded "Confirm" literal —
// both happened to equal "Confirm". This sentinel closes that gap: passing
// this bundle to renderWithProviders is the only way the button's text can
// ever equal CONFIRM_SENTINEL.
const CONFIRM_SENTINEL = '__CONFIRM_SENTINEL__'

function messagesWithSentinelConfirm() {
  const base = en as any
  return {
    ...base,
    settings: {
      ...base.settings,
      apiTokens: {
        ...base.settings.apiTokens,
        dialog: {
          ...base.settings.apiTokens.dialog,
          confirm: CONFIRM_SENTINEL,
        },
      },
    },
  }
}

const TOKEN_ROW = {
  id: 'tok-1',
  tenantId: 'default',
  tenant: { name: 'Provider' },
  name: 'prometheus-prod',
  description: null,
  tokenPrefix: 'pxc_Ab12Cd34',
  scopes: ['vms:read'],
  connectionIds: null,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: '2026-07-28T10:00:00.000Z',
  lastUsedIp: '203.0.113.9',
  rateLimitPerMin: 600,
  createdByUserId: 'admin-1',
  createdAt: '2026-07-01T10:00:00.000Z',
}

// Fix round 1, finding 1: tenant + connection plumbing fixtures. Mutable so
// individual tests can override before rendering (reset to these defaults
// in beforeEach).
let tenantsFetchOk = true
let connectionsFetchOk = true
let tenantsFixture: any[] = []
let vdcsFixture: any[] = []
let connectionsFixture: any[] = []

function resetFixtures() {
  tenantsFetchOk = true
  connectionsFetchOk = true
  tenantsFixture = [
    { id: 'default', name: 'Provider', enabled: true },
    { id: 'tenant-a', name: 'Tenant A', enabled: true },
  ]
  vdcsFixture = []
  connectionsFixture = [
    { id: 'conn-default', tenantId: 'default', name: 'Provider PVE' },
    { id: 'conn-a', tenantId: 'tenant-a', name: 'Tenant A PVE' },
  ]
}

beforeEach(() => {
  // Reset to the "licensed" default before every test: test 2 overrides this
  // for its own render, and mockReturnValue is sticky (unlike Once) so it
  // must be re-applied here or the override would leak into later tests.
  useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
  resetFixtures()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/settings/api-tokens' && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ data: [TOKEN_ROW] }), { status: 200 })
    }
    if (url === '/api/v1/settings/api-tokens' && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ data: { token: { ...TOKEN_ROW, id: 'tok-2' }, secret: 'pxc_SECRETVALUE' } }),
        { status: 201 },
      )
    }
    if (url.startsWith('/api/v1/settings/api-tokens/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ data: { id: 'tok-1', revokedAt: '2026-07-28T11:00:00.000Z' } }), { status: 200 })
    }
    if (url === '/api/v1/tenants') {
      return tenantsFetchOk
        ? new Response(JSON.stringify({ data: tenantsFixture }), { status: 200 })
        : new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    }
    if (url === '/api/v1/admin/vdcs') {
      return new Response(JSON.stringify({ data: vdcsFixture }), { status: 200 })
    }
    if (url === '/api/v1/admin/connections?type=pve') {
      return connectionsFetchOk
        ? new Response(JSON.stringify({ data: connectionsFixture }), { status: 200 })
        : new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    }
    return new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// Opens the create dialog and waits for the tenant + connection selectors to
// finish loading (3 comboboxes: expiration, tenant, connections).
async function openDialogWithTenantSelector() {
  renderWithProviders(<ApiTokensTab />)
  await screen.findByText('pxc_Ab12Cd34')
  await userEvent.click(screen.getByRole('button', { name: /new token/i }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => {
    expect(within(dialog).getAllByRole('combobox').length).toBeGreaterThanOrEqual(3)
  })
  return dialog
}

function lastPostBody() {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url, init]: any) => url === '/api/v1/settings/api-tokens' && init?.method === 'POST')
  expect(call, 'expected a POST to /api/v1/settings/api-tokens').toBeDefined()
  return JSON.parse((call as any)[1].body)
}

describe('ApiTokensTab', () => {
  it('lists tokens with prefix, scopes and last-used IP', async () => {
    renderWithProviders(<ApiTokensTab />)
    expect(await screen.findByText('pxc_Ab12Cd34')).toBeInTheDocument()
    expect(screen.getByText('prometheus-prod')).toBeInTheDocument()
    expect(screen.getByText('vms:read')).toBeInTheDocument()
    expect(screen.getByText(/203\.0\.113\.9/)).toBeInTheDocument()
  })

  // Owner feedback round: a Tenant column, showing the NAME the server joins
  // in (never the raw tenantId), and a key icon leading every row's identity
  // cell -- both plain, non-monospace text stays selectable.
  it('shows the tenant name (not the id) in a dedicated column', async () => {
    renderWithProviders(<ApiTokensTab />)
    const prefixCell = await screen.findByText('pxc_Ab12Cd34')
    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.queryByText('default')).not.toBeInTheDocument()
    const row = prefixCell.closest('.MuiDataGrid-row') as HTMLElement
    expect(row.querySelector('i.ri-key-2-line')).not.toBeNull()
  })

  it('shows the add-on upsell instead of the list when the option is missing', async () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: false })
    renderWithProviders(<ApiTokensTab />)
    // Fix round 1, finding 3: assert the upsell actually renders (FeatureGuard's
    // heading + add-on chip + the interpolated feature name), not merely that
    // the token list is absent -- an empty div or a crash boundary would also
    // satisfy an absence-only assertion.
    expect(await screen.findByText('Add-on required')).toBeInTheDocument()
    expect(screen.getByText('Add-on')).toBeInTheDocument()
    expect(screen.getByText(/ProxCenter API Access/)).toBeInTheDocument()
    expect(screen.queryByText('pxc_Ab12Cd34')).not.toBeInTheDocument()
  })

  it('revokes a token after confirmation', async () => {
    renderWithProviders(<ApiTokensTab />, { messages: messagesWithSentinelConfirm() })
    await screen.findByText('pxc_Ab12Cd34')
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await userEvent.click(screen.getByRole('button', { name: CONFIRM_SENTINEL }))
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/v1/settings/api-tokens/tok-1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('reveals the created secret exactly once, with an explicit warning', async () => {
    renderWithProviders(<ApiTokensTab />)
    await screen.findByText('pxc_Ab12Cd34')
    await userEvent.click(screen.getByRole('button', { name: /new token/i }))
    // Scoped to the dialog: the DataGrid's "Name" column menu button also
    // carries an accessible name matching /name/i outside this scope.
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-runner')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))
    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))
    expect(await screen.findByText('pxc_SECRETVALUE')).toBeInTheDocument()
    expect(screen.getByText(/never be shown again/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => {
      expect(screen.queryByText('pxc_SECRETVALUE')).not.toBeInTheDocument()
    })
  })

  // --- Fix round 1, finding 1: tenant + connection selectors -----------

  // Owner feedback round: the tenant dropdown reuses the Tenants settings tab
  // icon, and a PVE connection carries the PROXMOX MARK rather than a generic
  // glyph -- the convention the rest of the app already follows in
  // MigrateVmDialog's target-cluster selector. Both match the icon+label Stack
  // pattern the scope checkboxes use in this file.
  // (ri-link was tried first and rejected by the owner as the wrong icon.)
  it('shows the app icon vocabulary on the tenant and connection options', async () => {
    const dialog = await openDialogWithTenantSelector()

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    const tenantOption = await screen.findByRole('option', { name: 'Tenant A' })
    expect(tenantOption.querySelector('i.ri-building-line')).not.toBeNull()
    await userEvent.keyboard('{Escape}')

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[2])
    const connectionOption = await screen.findByRole('option', { name: 'Provider PVE' })
    const mark = connectionOption.querySelector('img')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('src')).toMatch(/proxmox-logo(-dark)?\.svg$/)
    // The checkbox this multi-select relies on must survive the icon addition.
    expect(within(connectionOption).getByRole('checkbox')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
  })

  it('sends the selected non-default tenant id', async () => {
    const dialog = await openDialogWithTenantSelector()
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-tenant-a')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))

    const tenantCombobox = within(dialog).getAllByRole('combobox')[1]
    fireEvent.mouseDown(tenantCombobox)
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))

    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(lastPostBody().tenantId).toBe('tenant-a')
    })
  })

  it('sends exactly the selected connection ids', async () => {
    const dialog = await openDialogWithTenantSelector()
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-conn-a')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A PVE' }))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(lastPostBody().connectionIds).toEqual(['conn-a'])
    })
  })

  it('clears the connection selection when the tenant changes', async () => {
    const dialog = await openDialogWithTenantSelector()
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-switch')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))

    // Pick tenant-a, then its connection.
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A PVE' }))
    await userEvent.keyboard('{Escape}')

    // Switch back to the default tenant: a stale tenant-a connection id
    // would either be rejected server-side or, worse, silently scope the
    // token against the wrong tenant's connection.
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Provider' }))

    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      const body = lastPostBody()
      expect(body.tenantId).toBe('default')
      expect(body.connectionIds).toBeNull()
    })
  })

  it('still allows creation when the tenants fetch fails', async () => {
    tenantsFetchOk = false
    renderWithProviders(<ApiTokensTab />)
    await screen.findByText('pxc_Ab12Cd34')
    await userEvent.click(screen.getByRole('button', { name: /new token/i }))
    const dialog = await screen.findByRole('dialog')

    // Degrades to the pre-fix UI: no tenant selector, plain free-text
    // connections field (a single combobox: expiration only).
    await waitFor(() => {
      expect(within(dialog).getAllByRole('combobox').length).toBe(1)
    })
    expect(within(dialog).queryByLabelText(/tenant/i)).not.toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-fallback')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))
    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText('pxc_SECRETVALUE')).toBeInTheDocument()
    expect(lastPostBody().tenantId).toBeUndefined()
  })

  // Fix round 4 (owner-reported): the eight scope checkboxes used to render
  // as one run-on line ("vms:readnodes:readstorage:read...") because bare
  // FormControlLabels are inline-flex and flow together with no
  // separation. Covers both halves of the fix: a block-level row per scope,
  // and a domain icon matching the app's existing icon vocabulary for that
  // domain instead of no icon at all.
  it('lays out each scope checkbox on its own row with a matching domain icon', async () => {
    const dialog = await openDialogWithTenantSelector()

    const scopeIcons: Record<string, string> = {
      'vms:read': 'ri-computer-line',
      'nodes:read': 'ri-server-line',
      'storage:read': 'ri-hard-drive-2-line',
      'backups:read': 'ri-save-line',
      'automation:read': 'ri-robot-line',
      'alerts:read': 'ri-alarm-warning-line',
      'reports:read': 'ri-file-list-3-line',
      'compliance:read': 'ri-shield-check-line',
    }

    const rows = Object.entries(scopeIcons).map(([scope, iconClass]) => {
      const checkbox = within(dialog).getByLabelText(scope)
      const row = checkbox.closest('label') as HTMLElement
      expect(row, `expected a label row for ${scope}`).not.toBeNull()
      expect(row.querySelector(`i.${iconClass}`), `expected ${iconClass} on the ${scope} row`).not.toBeNull()
      return row
    })

    // One-per-line: every row is a distinct FormControlLabel, all direct
    // children of the same FormGroup (a block-level, column-flex container)
    // rather than sharing the FormControlLabels' own inline-flex flow.
    rows.forEach(row => expect(row.className).toContain('MuiFormControlLabel-root'))
    const container = rows[0].parentElement
    expect(container?.className).toContain('MuiFormGroup-root')
    rows.forEach(row => expect(row.parentElement).toBe(container))
  })

  it('still offers the free-text connections field when only the connections fetch fails', async () => {
    // Fix round 2, finding 1: tenants load fine (tenantsAvailable=true) but
    // the connections fetch fails independently. Before the fix, the render
    // branched on tenantsAvailable alone, so the multi-select rendered with
    // zero options and the free-text fallback never appeared -- a dead end.
    connectionsFetchOk = false
    renderWithProviders(<ApiTokensTab />)
    await screen.findByText('pxc_Ab12Cd34')
    await userEvent.click(screen.getByRole('button', { name: /new token/i }))
    const dialog = await screen.findByRole('dialog')

    // Tenant selector still present (tenants loaded), but the connections
    // control degrades to free text: 2 comboboxes (expiration, tenant), no
    // third combobox for connections.
    await waitFor(() => {
      expect(within(dialog).getAllByRole('combobox').length).toBe(2)
    })

    await userEvent.type(within(dialog).getByLabelText(/name/i), 'ci-conn-fallback')
    await userEvent.click(within(dialog).getByLabelText('vms:read'))
    await userEvent.type(within(dialog).getByLabelText(/connections/i), 'conn-x, conn-y')
    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(lastPostBody().connectionIds).toEqual(['conn-x', 'conn-y'])
    })
  })
})
