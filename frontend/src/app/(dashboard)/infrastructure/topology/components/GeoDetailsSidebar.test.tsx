import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/components/ChartContainer', () => ({ default: () => null }))

import GeoDetailsSidebar from './GeoDetailsSidebar'
import type { InventoryCluster } from '../types'

const cluster: InventoryCluster = {
  id: 'c1',
  name: 'Paris DC',
  type: 'pve',
  isCluster: true,
  status: 'online',
  nodes: [
    {
      node: 'pve1', status: 'online', cpu: 0.25, mem: 4, maxmem: 8, uptime: 90000,
      guests: [{ vmid: 101, name: 'db-01', status: 'running', type: 'qemu', node: 'pve1' }],
    },
    { node: 'pve2', status: 'offline', guests: [] },
  ],
}

describe('GeoDetailsSidebar trends', () => {
  afterEach(cleanup)

  it('fetches node RRD and guest trends on mount', async () => {
    const rrdPaths: (string | null)[] = []
    const trendBodies: unknown[] = []
    server.use(
      http.get('*/api/v1/connections/c1/rrd', ({ request }) => {
        rrdPaths.push(new URL(request.url).searchParams.get('path'))
        return HttpResponse.json([{ time: 1_700_000_000, cpu: 0.5, memused: 2, memtotal: 8 }])
      }),
      http.post('*/api/v1/connections/c1/guests/trends', async ({ request }) => {
        trendBodies.push(await request.json())
        return HttpResponse.json({ data: { 'qemu:pve1:101': [{ t: '10:00', cpu: 10, ram: 20 }] } })
      }),
    )

    renderWithProviders(<GeoDetailsSidebar cluster={cluster} onClose={vi.fn()} />)

    expect(screen.getByText('Paris DC')).toBeInTheDocument()
    await waitFor(() => expect(trendBodies).toHaveLength(1))
    expect(rrdPaths).toEqual(['/nodes/pve1'])
    expect(trendBodies[0]).toEqual({ items: [{ type: 'qemu', node: 'pve1', vmid: '101' }], timeframe: 'hour' })
  })
})
