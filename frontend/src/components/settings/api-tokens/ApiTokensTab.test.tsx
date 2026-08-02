import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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

// Sourced from the translation table (not a hand-typed guess) so this
// assertion can only pass if the button text tracks settings.apiTokens.dialog.confirm.
const CONFIRM_LABEL = (en as any).settings.apiTokens.dialog.confirm

const TOKEN_ROW = {
  id: 'tok-1',
  tenantId: 'default',
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

beforeEach(() => {
  // Reset to the "licensed" default before every test: test 2 overrides this
  // for its own render, and mockReturnValue is sticky (unlike Once) so it
  // must be re-applied here or the override would leak into later tests.
  useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
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
    return new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('ApiTokensTab', () => {
  it('lists tokens with prefix, scopes and last-used IP', async () => {
    renderWithProviders(<ApiTokensTab />)
    expect(await screen.findByText('pxc_Ab12Cd34')).toBeInTheDocument()
    expect(screen.getByText('prometheus-prod')).toBeInTheDocument()
    expect(screen.getByText('vms:read')).toBeInTheDocument()
    expect(screen.getByText(/203\.0\.113\.9/)).toBeInTheDocument()
  })

  it('shows the add-on upsell instead of the list when the option is missing', async () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: false })
    renderWithProviders(<ApiTokensTab />)
    await waitFor(() => {
      expect(screen.queryByText('pxc_Ab12Cd34')).not.toBeInTheDocument()
    })
  })

  it('revokes a token after confirmation', async () => {
    renderWithProviders(<ApiTokensTab />)
    await screen.findByText('pxc_Ab12Cd34')
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await userEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }))
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
})
