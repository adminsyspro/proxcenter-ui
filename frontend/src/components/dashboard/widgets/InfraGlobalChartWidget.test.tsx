import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import InfraGlobalChartWidget from './InfraGlobalChartWidget'

/**
 * Same bug class as #611: the connection filter is persisted in the widget
 * settings, so an empty chart used to replace the controls permanently — a
 * page reload restored the filter and landed straight back on "No data".
 */

// This project does not enable Vitest globals, so RTL's auto-cleanup is off.
afterEach(cleanup)

const data = {
  clusters: [{ id: 'c1', name: 'cluster-1' }, { id: 'c2', name: 'cluster-2' }],
  nodes: [
    { name: 'pve-01', node: 'pve-01', connectionId: 'c1' },
    { name: 'pve-02', node: 'pve-02', connectionId: 'c2' },
  ],
}

// The widget fetches one trends endpoint per selected connection.
const respondWith = (payload: unknown) =>
  server.use(
    http.post('/api/v1/connections/:connId/nodes/trends', () => HttpResponse.json({ data: payload })),
  )

const render = (settings: Record<string, unknown>) =>
  renderWithProviders(
    <InfraGlobalChartWidget
      data={data}
      loading={false}
      timeRange="1h"
      config={{ settings }}
      onUpdateSettings={() => {}}
    />,
  )

describe('InfraGlobalChartWidget empty states', () => {
  it('keeps its controls when the selected connection has no trend data', async () => {
    respondWith({})
    render({ selectedConnections: ['c2'] })

    expect(await screen.findByText('No results')).toBeInTheDocument()

    // The bug: the metric toggle and the connection filter used to vanish,
    // leaving no way to widen the selection back out.
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('RAM')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })

  it('falls back to the plain no-data card when no filter is responsible', async () => {
    respondWith({})
    render({})

    expect(await screen.findByText('No data')).toBeInTheDocument()
    expect(screen.queryByText('Reset')).not.toBeInTheDocument()
  })

  it('renders the chart when the selected connection returns points', async () => {
    respondWith({ 'node:pve-02': [{ ts: 1, t: '10:00', cpu: 12, ram: 34 }] })
    render({ selectedConnections: ['c2'] })

    // Wait for the controls to actually mount: the widget paints a spinner
    // first, so asserting an absence here would pass before anything renders.
    expect(await screen.findByText('CPU')).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })
})
