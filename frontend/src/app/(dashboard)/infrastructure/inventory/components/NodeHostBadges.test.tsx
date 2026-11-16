import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

import RBACContext from '@/contexts/RBACContext'

import NodeHostBadges from './NodeHostBadges'

const HOST = {
  pveVersion: '9.2.26',
  updates: [
    { package: 'pve-manager', currentVersion: '9.2.25', newVersion: '9.2.26' },
    { package: 'qemu-server', currentVersion: '9.1.0', newVersion: '9.1.2' },
  ],
  subscription: { status: 'notfound', type: 'Community', key: 'pve4c-0000', sockets: 2 },
}

const ADMIN = { isAdmin: true, loading: false, hasPermission: () => true }

function renderBadges(hostInfo: any = HOST, rbac: Record<string, unknown> = ADMIN, onRefreshSubscription?: () => void) {
  return renderWithProviders(
    <RBACContext.Provider value={rbac as any}>
      <NodeHostBadges hostInfo={hostInfo} connId="conn1" nodeName="pve1" onRefreshSubscription={onRefreshSubscription} />
    </RBACContext.Provider>
  )
}

describe('NodeHostBadges', () => {
  it('names the pending updates and the subscription state on two badges', () => {
    renderBadges()

    expect(screen.getByRole('button', { name: /2 updates/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inactive/i })).toBeInTheDocument()
  })

  it('opens a dialog listing every pending update with its versions', async () => {
    renderBadges()

    await userEvent.click(screen.getByRole('button', { name: /2 updates/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('pve-manager')).toBeInTheDocument()
    expect(within(dialog).getByText('qemu-server')).toBeInTheDocument()
    expect(within(dialog).getByText('9.1.2')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /upgrade/i })).toBeInTheDocument()
  })

  it('opens a dialog with the subscription details, and checks it again on demand', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const onRefresh = vi.fn()
    renderBadges(HOST, ADMIN, onRefresh)

    await userEvent.click(screen.getByRole('button', { name: /inactive/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('Community')).toBeInTheDocument()
    expect(within(dialog).getByText('pve4c-0000')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: /check/i }))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/connections/conn1/nodes/pve1/subscription', { method: 'POST' })
    expect(onRefresh).toHaveBeenCalled()
  })

  it('shows nothing to a user who is not an admin', () => {
    const { container } = renderBadges(HOST, { isAdmin: false, loading: false, hasPermission: () => false })

    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing on an up-to-date node without subscription data', () => {
    const { container } = renderBadges({ pveVersion: '9.2.26', updates: [] })

    expect(container).toBeEmptyDOMElement()
  })
})
