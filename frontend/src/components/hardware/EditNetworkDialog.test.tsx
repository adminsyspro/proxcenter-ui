import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import { EditNetworkDialog } from './EditNetworkDialog'

vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ loading: false, permissions: ['vm.config.nic'], isAdmin: false }) }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ loading: false, currentTenant: { id: 'tenant-a' }, isProvider: false }) }))
afterEach(cleanup)

describe('tenant NIC edit', () => {
  it('allows disconnect while preserving protected values from the original PVE config', async () => {
    server.use(http.get('*/api/v1/connections/conn-1/network-choices', () => HttpResponse.json({ data: [{ name: 'vmbr0', kind: 'shared' }] })))
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<EditNetworkDialog open onClose={() => {}} onSave={onSave} onDelete={async () => {}} connId="conn-1" node="pve1" network={{
      id: 'net0', model: 'virtio', bridge: 'vmbr0', macaddr: 'AA:BB:CC:DD:EE:FF', tag: 42,
      rawValue: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,queues=4', queues: 4,
    }} />)
    expect(screen.getByLabelText('MAC address')).toBeDisabled()
    expect(screen.getByLabelText('VLAN Tag')).toBeDisabled()
    expect(screen.getByLabelText('VLAN Tag')).toHaveValue(42)
    await userEvent.click(screen.getByLabelText('Disconnect'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,queues=4,link_down=1' }))
  })
})
