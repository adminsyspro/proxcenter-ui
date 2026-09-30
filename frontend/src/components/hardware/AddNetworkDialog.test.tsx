import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/hooks/useNicIdentityPermissions', () => ({
  useNicIdentityPermissions: () => ({ canEditMac: true, canEditVlan: true, loading: false }),
}))

import { AddNetworkDialog } from './AddNetworkDialog'

const CONN_ID = 'conn-1'
const NODE = 'pve1'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    connId: CONN_ID,
    node: NODE,
    vmid: '100',
    existingNets: ['net0'],
    ...overrides,
  }
}

describe('AddNetworkDialog bridge loading', () => {
  afterEach(cleanup)

  it('loads bridges on open and saves on the first returned bridge', async () => {
    const seen: string[] = []
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('node') ?? '')
        return HttpResponse.json({ data: [{ name: 'vmbr7' }, { name: 'vmbr8' }] })
      }),
    )
    const props = makeProps()
    renderWithProviders(<AddNetworkDialog {...props} />)

    await waitFor(() => expect(seen).toEqual([NODE]))
    await waitFor(() => expect(screen.getAllByText('vmbr7').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ net1: 'virtio,bridge=vmbr7,firewall=1' }))
  })

  it('falls back to vmbr0 when the bridge endpoint fails', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, () => HttpResponse.json({}, { status: 500 })),
    )
    const props = makeProps({ existingNets: [] })
    renderWithProviders(<AddNetworkDialog {...props} />)

    await waitFor(() => expect(screen.getAllByText('vmbr0').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ net0: 'virtio,bridge=vmbr0,firewall=1' }))
  })
})
