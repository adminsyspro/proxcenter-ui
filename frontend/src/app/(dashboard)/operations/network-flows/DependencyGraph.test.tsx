import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges }: { nodes: { id: string }[]; edges: { source: string; target: string }[] }) => (
    <div>
      <div data-testid="nodes">{nodes.map(n => n.id).sort().join(',')}</div>
      <div data-testid="edges">{edges.map(e => `${e.source}>${e.target}`).join(',')}</div>
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  useNodesState: (init: unknown[]) => { const [s, set] = useState(init); return [s, set, vi.fn()] },
  useEdgesState: (init: unknown[]) => { const [s, set] = useState(init); return [s, set, vi.fn()] },
  MarkerType: { ArrowClosed: 'arrowclosed' },
}))

import DependencyGraph from './DependencyGraph'

describe('DependencyGraph', () => {
  afterEach(cleanup)

  it('fetches the sFlow IP pairs on mount and draws them as a graph', async () => {
    const queries: string[] = []
    server.use(
      http.get('*/api/v1/orchestrator/sflow', ({ request }) => {
        queries.push(new URL(request.url).search)
        return HttpResponse.json([
          { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', bytes: 4096, packets: 4, protocol: 'tcp', dst_port: 443 },
        ])
      }),
    )

    renderWithProviders(<DependencyGraph connectionId="c1" />)

    await waitFor(() => expect(screen.getByTestId('nodes')).toHaveTextContent('10.0.0.1,10.0.0.2'))
    expect(screen.getByTestId('edges')).toHaveTextContent('10.0.0.1>10.0.0.2')
    expect(queries[0]).toBe('?endpoint=ip-pairs&n=50')
  })

  it('shows the waiting state when the endpoint fails', async () => {
    server.use(http.get('*/api/v1/orchestrator/sflow', () => HttpResponse.json({}, { status: 503 })))
    renderWithProviders(<DependencyGraph connectionId="c1" />)
    expect(await screen.findByText('Waiting for sFlow data...', { exact: false })).toBeInTheDocument()
  })
})
