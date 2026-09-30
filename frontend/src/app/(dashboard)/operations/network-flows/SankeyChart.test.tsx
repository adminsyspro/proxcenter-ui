import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import SankeyChart from './SankeyChart'

describe('SankeyChart', () => {
  afterEach(cleanup)

  it('fetches the sFlow IP pairs on mount and draws source, service and destination nodes', async () => {
    const queries: string[] = []

    server.use(
      http.get('*/api/v1/orchestrator/sflow', ({ request }) => {
        queries.push(new URL(request.url).search)

        return HttpResponse.json([
          { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', bytes: 4096, packets: 4, protocol: 'tcp', dst_port: 443 },
          { src_ip: '10.0.0.3', dst_ip: '10.0.0.2', bytes: 2048, packets: 2, protocol: 'udp', dst_port: 5555 },
        ])
      }),
    )

    renderWithProviders(<SankeyChart />)

    expect(await screen.findByText('10.0.0.1')).toBeInTheDocument()
    expect(screen.getByText('HTTPS')).toBeInTheDocument()
    expect(screen.getByText('5555/udp')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument()
    expect(queries).toEqual(['?endpoint=ip-pairs&n=100'])
  })

  it('leaves the loading state with no flow drawn when the endpoint fails', async () => {
    server.use(http.get('*/api/v1/orchestrator/sflow', () => HttpResponse.json({}, { status: 503 })))

    renderWithProviders(<SankeyChart />)

    expect(await screen.findByText('Waiting for sFlow data...', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('HTTPS')).not.toBeInTheDocument()
  })
})
