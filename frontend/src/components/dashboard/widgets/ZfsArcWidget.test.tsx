import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import ZfsArcWidget, { selectArcNodes } from './ZfsArcWidget'

/**
 * #617: the ARC series used to share the memory chart's linear axis, where a
 * few MB of ARC against GB of RAM is an invisible flat line. The dedicated
 * widget only holds up if it also refuses to plot nodes that have no ARC at
 * all — PVE 8 has no `arcsize` column, and a node without ZFS reports nothing.
 */

// This project does not enable Vitest globals, so RTL's auto-cleanup is off.
afterEach(cleanup)

const data = {
  clusters: [{ id: 'c1', name: 'cluster-1' }],
  nodes: [
    { name: 'pve-01', node: 'pve-01', connectionId: 'c1' },
    { name: 'pve-02', node: 'pve-02', connectionId: 'c1' },
  ],
}

const respondWith = (payload: unknown) =>
  server.use(
    http.post('/api/v1/connections/:connId/nodes/trends', () => HttpResponse.json({ data: payload })),
  )

const render = (settings: Record<string, unknown> = {}) =>
  renderWithProviders(
    <ZfsArcWidget
      data={data}
      loading={false}
      timeRange="1h"
      config={{ settings }}
      onUpdateSettings={() => {}}
    />,
  )

describe('selectArcNodes', () => {
  const series = [
    { ts: 1, 'pve-01_arc': 3221225472, 'pve-02_arc': null },
    { ts: 2, 'pve-01_arc': 3221225472, 'pve-02_arc': null },
  ]

  it('keeps a node that reports ARC', () => {
    expect(selectArcNodes(series, ['pve-01', 'pve-02'])).toEqual(['pve-01'])
  })

  it('drops a node whose ARC is always zero (no ZFS)', () => {
    const zeroed = [{ ts: 1, 'pve-03_arc': 0 }, { ts: 2, 'pve-03_arc': 0 }]

    expect(selectArcNodes(zeroed, ['pve-03'])).toEqual([])
  })

  it('returns nothing when there is no series at all', () => {
    expect(selectArcNodes(null, ['pve-01'])).toEqual([])
    expect(selectArcNodes([], ['pve-01'])).toEqual([])
  })
})

describe('ZfsArcWidget', () => {
  it('explains the PVE 9 requirement when no node reports ARC', async () => {
    respondWith({ 'node:pve-01': [{ ts: 1, t: '10:00', cpu: 5, ram: 40, arc: null, arcPct: null }] })
    render()

    expect(await screen.findByText(/No ZFS ARC data/i)).toBeInTheDocument()
  })

  it('plots the chart as soon as one node reports ARC', async () => {
    respondWith({
      'node:pve-01': [{ ts: 1, t: '10:00', cpu: 5, ram: 40, arc: 3221225472, arcPct: 18.7 }],
      'node:pve-02': [{ ts: 1, t: '10:00', cpu: 7, ram: 51, arc: null, arcPct: null }],
    })
    render()

    // Wait for the controls to actually mount: the widget paints a spinner
    // first, so asserting an absence here would pass before anything renders.
    expect(await screen.findByText('ARC')).toBeInTheDocument()
    expect(screen.getByText('% RAM')).toBeInTheDocument()
    expect(screen.queryByText(/No ZFS ARC data/i)).not.toBeInTheDocument()
  })

  it('keeps its controls and offers a reset when a connection filter empties the chart', async () => {
    respondWith({})
    render({ selectedConnections: ['c1'] })

    expect(await screen.findByText(/No ZFS ARC data/i)).toBeInTheDocument()

    // Same bug class as #611: the filter is persisted, so it must stay reachable.
    expect(screen.getByText('ARC')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })
})
