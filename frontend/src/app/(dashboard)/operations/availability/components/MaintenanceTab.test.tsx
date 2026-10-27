import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { inventoryFixture } from './fixtures'
import { inventoryOptions } from './inventoryOptions'
import MaintenanceTab, { windowStatus } from './MaintenanceTab'
import type { WindowItem } from './slaApi'

const { windowsMock, mutate } = vi.hoisted(() => ({ windowsMock: vi.fn(), mutate: vi.fn() }))

vi.mock('../hooks/useSlaLists', () => ({
  useMaintenanceWindows: (page: number) => windowsMock(page),
  useInventoryOptions: () => ({ options: inventoryOptions(inventoryFixture), error: undefined, isLoading: false }),
  useAllPolicies: () => ({ data: { items: [{ id: 'p1', name: 'Gold', enabled: true }] } }),
}))

vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => true }) }))

const NOW = Date.parse('2026-10-27T12:00:00.000Z')

const win = (id: string, over: Partial<WindowItem>): WindowItem => ({
  id,
  scope: 'connection',
  connectionId: 'c1',
  node: null,
  vmid: null,
  policyId: null,
  startsAt: '2026-10-27T11:00:00.000Z',
  endsAt: '2026-10-27T13:00:00.000Z',
  reason: 'Firmware update',
  createdBy: 'admin@example.com',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
})

const fetchMock = vi.fn()

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  mutate.mockReset().mockResolvedValue(undefined)
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  windowsMock.mockReset().mockImplementation((n: number) => ({
    data: {
      data: [
        win('w1', {}),
        win('w2', { scope: 'node', node: 'pve1', startsAt: '2026-10-28T10:00:00.000Z', endsAt: '2026-10-28T11:00:00.000Z' }),
        win('w3', { scope: 'policy', connectionId: null, policyId: 'p1', startsAt: '2026-10-01T10:00:00.000Z', endsAt: '2026-10-01T11:00:00.000Z' }),
      ],
      total: 45,
      page: n,
      pageSize: 20,
    },
    error: undefined,
    isLoading: false,
    mutate,
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('windowStatus', () => {
  const w = { startsAt: '2026-10-27T11:00:00.000Z', endsAt: '2026-10-27T13:00:00.000Z' }

  it('is upcoming before the start, ongoing from it, past from the end', () => {
    expect(windowStatus(w, Date.parse('2026-10-27T10:59:59.000Z'))).toBe('upcoming')
    expect(windowStatus(w, Date.parse('2026-10-27T11:00:00.000Z'))).toBe('ongoing')
    expect(windowStatus(w, Date.parse('2026-10-27T13:00:00.000Z'))).toBe('past')
  })
})

describe('MaintenanceTab', () => {
  it('lists one row per window with its status, target and author, paginated', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceTab />)

    expect(screen.getByText('Ongoing')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByText('Paris')).toBeInTheDocument()
    expect(screen.getByText('Paris / pve1')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getAllByText('admin@example.com')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: /page 2/i }))
    expect(windowsMock).toHaveBeenLastCalledWith(2)
  })

  it('shows the reason and the length of each window in their columns', () => {
    renderWithProviders(<MaintenanceTab />)

    expect(screen.getAllByText('Firmware update').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Duration' })).toBeInTheDocument()
  })

  it('deletes through the modal then refreshes', async () => {
    const user = userEvent.setup()

    renderWithProviders(<MaintenanceTab />)

    await user.click(screen.getByRole('button', { name: 'Delete Paris' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete this maintenance window?')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sla/maintenance-windows/w1', expect.objectContaining({ method: 'DELETE' }))
  })
})
