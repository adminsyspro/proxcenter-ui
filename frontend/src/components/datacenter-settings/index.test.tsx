/**
 * DatacenterSettingsTab fetches the cluster options on mount (fire-and-forget
 * `void fetchOptions()` in the mount effect) and hydrates its sections from
 * the PVE option strings.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
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
