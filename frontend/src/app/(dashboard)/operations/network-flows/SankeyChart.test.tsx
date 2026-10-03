import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
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

  it('labels attributed IPs with their VM and searches past the global top pairs', async () => {
    const queries: string[] = []
    const top = [
      { src_ip: '10.0.0.1', src_vmid: 101, src_name: 'web-01', dst_ip: '10.0.0.2', bytes: 4096, packets: 4, protocol: 'tcp', dst_port: 443 },
      { src_ip: '10.0.0.3', dst_ip: '10.0.0.2', bytes: 2048, packets: 2, protocol: 'udp', dst_port: 53 },
    ]
    const quiet = { src_ip: '10.0.0.9', src_vmid: 109, src_name: 'backup-09', dst_ip: '10.0.0.2', bytes: 10, packets: 1, protocol: 'tcp', dst_port: 22 }

    server.use(
      http.get('*/api/v1/orchestrator/sflow', ({ request }) => {
        const url = new URL(request.url)
        queries.push(url.search)
        return HttpResponse.json(url.searchParams.get('q') ? [quiet] : top)
      }),
    )

    renderWithProviders(<SankeyChart />)

    expect(await screen.findByText('web-01 (10.0.0.1)')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search by IP, VM name or VMID' }), { target: { value: 'backup' } })

    expect(await screen.findByText('backup-09 (10.0.0.9)')).toBeInTheDocument()
    expect(screen.getByText('1 matching flow')).toBeInTheDocument()
    expect(queries).toContain('?endpoint=ip-pairs&n=100&q=backup')
    // Highlight mode keeps the rest of the diagram for context
    expect(screen.getByText('web-01 (10.0.0.1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))

    expect(await screen.findByText('backup-09 (10.0.0.9)')).toBeInTheDocument()
    expect(screen.queryByText('web-01 (10.0.0.1)')).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search by IP, VM name or VMID' }), { key: 'Enter' })

    expect(await screen.findByRole('dialog')).toHaveTextContent('ID 109')
  })

  it('says so when no flow matches in filter mode', async () => {
    server.use(
      http.get('*/api/v1/orchestrator/sflow', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get('q') ? [] : [
          { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', bytes: 4096, packets: 4, protocol: 'tcp', dst_port: 443 },
        ])),
    )

    renderWithProviders(<SankeyChart />)
    await screen.findByText('10.0.0.1')

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by IP, VM name or VMID' }), { target: { value: 'nothing' } })

    expect(await screen.findByText('No flow matches "nothing"')).toBeInTheDocument()
    expect(screen.queryByText('10.0.0.1')).not.toBeInTheDocument()
  })
})
