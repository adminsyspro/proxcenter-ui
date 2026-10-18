/**
 * Component tests for AutoHaCard: the Auto-HA settings cover the whole
 * connection, so the routes require node.manage on it. Below that the card is
 * read-only; a refused save keeps the stored settings on screen and toasts
 * why, a refused sync shows an error, never a success. Routes served by MSW.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

const h = vi.hoisted(() => ({
  // node.manage on the whole connection (true) or on one node only (false).
  connectionScoped: true,
  toast: { showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => h.toast }))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({
    hasPermission: () => true,
    // A node-scoped node.manage holder has it on conn-1:pve1, never on the connection.
    hasPermissionOn: (p: string, type: string, id: string) =>
      p === 'node.manage' && (h.connectionScoped ? id.startsWith('conn-1') : type === 'node' && id === 'conn-1:pve1'),
  }),
}))

import AutoHaCard from './AutoHaCard'

const BASE = '*/api/v1/connections/conn-1/ha/auto-ha'
const STORED = { enabled: true, state: 'started', group: '', max_restart: 1, max_relocate: 1, comment: 'Auto-HA' }

function renderCard() {
  renderWithProviders(<AutoHaCard connId="conn-1" pveMajorVersion={9} haGroups={[]} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.connectionScoped = true
  server.use(http.get(BASE, () => HttpResponse.json({ data: STORED })))
})

afterEach(() => {
  cleanup()
})

describe('AutoHaCard', () => {
  it('is read-only without node.manage on the whole connection', async () => {
    h.connectionScoped = false
    renderCard()

    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument())
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Sync Now/ })).toBeDisabled()
    expect(screen.getByLabelText('Max Restart')).toBeDisabled()
    expect(screen.getByLabelText('Max Relocate')).toBeDisabled()
  })

  it('is editable with node.manage on the connection', async () => {
    renderCard()

    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument())
    expect(screen.getByRole('switch')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Save/ })).not.toBeDisabled()
    expect(screen.getByLabelText('Max Restart')).not.toBeDisabled()
  })

  it('a refused save keeps the stored settings on screen and toasts the reason', async () => {
    server.use(http.put(BASE, () => HttpResponse.json({ error: 'Permission denied: node.manage' }, { status: 403 })))
    renderCard()

    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Permission denied: node.manage'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument()
  })

  it('a refused sync shows the error, not a success', async () => {
    server.use(http.post(`${BASE}/sync`, () => HttpResponse.json({ error: 'Permission denied: node.manage' }, { status: 403 })))
    renderCard()

    await waitFor(() => expect(screen.getByRole('button', { name: /Sync Now/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Sync Now/ }))

    expect(await screen.findByText('Permission denied: node.manage')).toBeInTheDocument()
    expect(document.querySelector('.MuiAlert-standardSuccess')).toBeNull()
  })
})
