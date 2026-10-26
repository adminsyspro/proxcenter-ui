/**
 * DatacenterSettingsTab fetches the cluster options on mount (fire-and-forget
 * `void fetchOptions()` in the mount effect) and hydrates its sections from
 * the PVE option strings.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

import DatacenterSettingsTab from './index'

afterEach(cleanup)

describe('DatacenterSettingsTab', () => {
  it('loads the cluster options on mount and fills the fields from them', async () => {
    server.use(
      http.get('*/api/v1/connections/conn-1/cluster/options', () =>
        HttpResponse.json({
          data: { 'next-id': 'lower=5000,upper=6000', 'registered-tags': 'prod;db', 'tag-style': 'shape=circle' },
        }),
      ),
      http.get('*/api/v1/connections/conn-1/nodes', () => HttpResponse.json({ data: [] })),
    )

    renderWithProviders(<DatacenterSettingsTab connectionId="conn-1" />)

    expect(await screen.findByDisplayValue('5000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('6000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('prod;db')).toBeInTheDocument()
  })

  it('shows the HTTP error when the options request fails', async () => {
    server.use(
      http.get('*/api/v1/connections/conn-1/cluster/options', () => new HttpResponse(null, { status: 502 })),
    )

    renderWithProviders(<DatacenterSettingsTab connectionId="conn-1" />)

    expect(await screen.findByText('HTTP 502')).toBeInTheDocument()
  })
})

describe('DatacenterSettingsTab save (#1207)', () => {
  it('sends the registered tags PVE returned as an array as a ; list and keeps the crs keys the form does not show', async () => {
    const puts: Array<Record<string, string>> = []
    server.use(
      http.get('*/api/v1/connections/conn-1/cluster/options', () =>
        HttpResponse.json({
          data: {
            'registered-tags': ['ha-on', 'virt-ct'],
            crs: { ha: 'dynamic', 'ha-auto-rebalance': 1, 'ha-rebalance-on-start': 1 },
            'user-tag-access': { 'user-allow': 'free' },
          },
        }),
      ),
      http.get('*/api/v1/connections/conn-1/nodes', () => HttpResponse.json({ data: [] })),
      http.put('*/api/v1/connections/conn-1/cluster/options', async ({ request }) => {
        puts.push(await request.json() as Record<string, string>)
        return HttpResponse.json({ data: { success: true } })
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<DatacenterSettingsTab connectionId="conn-1" />)

    expect(await screen.findByDisplayValue('ha-on;virt-ct')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'User Tag Access' }))
    await user.click(await screen.findByRole('option', { name: 'List' }))
    await user.type(screen.getByLabelText('Allowed Tags'), 'ok-1;ok-2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]['registered-tags']).toBe('ha-on;virt-ct')
    expect(puts[0].crs).toBe('ha=dynamic,ha-auto-rebalance=1,ha-rebalance-on-start=1')
    expect(puts[0]['user-tag-access']).toBe('user-allow=list,user-allow-list=ok-1;ok-2')
  })

  it('hides the allowed tags in free mode and describes the selected mode', async () => {
    server.use(
      http.get('*/api/v1/connections/conn-1/cluster/options', () =>
        HttpResponse.json({ data: { 'user-tag-access': { 'user-allow': 'none' } } }),
      ),
      http.get('*/api/v1/connections/conn-1/nodes', () => HttpResponse.json({ data: [] })),
    )

    renderWithProviders(<DatacenterSettingsTab connectionId="conn-1" />)

    expect(await screen.findByText('Users cannot add or remove any tag.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Allowed Tags')).not.toBeInTheDocument()
  })
})
