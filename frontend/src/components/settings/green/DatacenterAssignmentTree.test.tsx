/**
 * Component tests for DatacenterAssignmentTree: the mount-time load of the
 * PVE connections, the ownership map and each cluster's node list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import DatacenterAssignmentTree, { type AssignmentState } from './DatacenterAssignmentTree'

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

const EMPTY: AssignmentState = { clusters: new Set(), nodes: new Set() }
const INITIAL_WITH_PARIS: AssignmentState = { clusters: new Set(['c1']), nodes: new Set() }

let fetchMock: ReturnType<typeof vi.fn>

function stubFetch(connStatus = 200) {
  fetchMock = vi.fn(async (input: any) => {
    const url = String(input)

    if (url === '/api/v1/connections?type=pve') {
      return jsonRes({
        data: [
          { id: 'c1', name: 'paris', type: 'pve' },
          { id: 'c2', name: 'lyon', type: 'pve' },
          { id: 'b1', name: 'backup', type: 'pbs' },
        ],
      }, connStatus)
    }
    if (url === '/api/v1/admin/green-assignments') {
      return jsonRes({ data: { clusters: { c2: { datacenterId: 'dc-other', datacenterName: 'DC North' } }, nodes: {} } })
    }
    if (url === '/api/v1/admin/connections/c1/green-config') {
      return jsonRes({ data: { nodes: [{ nodeName: 'pve1', status: 'online' }, { nodeName: 'pve2' }] } })
    }
    if (url === '/api/v1/admin/connections/c2/green-config') return jsonRes({}, 500)

    return jsonRes({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => stubFetch())

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DatacenterAssignmentTree', () => {
  it('lists the PVE clusters only, and marks a cluster owned by another DC', async () => {
    renderWithProviders(
      <DatacenterAssignmentTree state={EMPTY} initialState={EMPTY} onChange={vi.fn()} currentDcId="dc-1" />,
    )

    expect(await screen.findByText('paris')).toBeInTheDocument()
    expect(screen.getByText('lyon')).toBeInTheDocument()
    expect(screen.queryByText('backup')).not.toBeInTheDocument()
    expect(screen.getByText('→ DC North')).toBeInTheDocument()

    // Ownership + every cluster's node list are fetched up front.
    const urls = fetchMock.mock.calls.map(c => String(c[0]))

    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/admin/green-assignments',
      '/api/v1/admin/connections/c1/green-config',
      '/api/v1/admin/connections/c2/green-config',
    ]))

    const lyonBox = screen.getByText('lyon').closest('label')!.querySelector('input')!

    expect(lyonBox).toBeDisabled()
  })

  it('expands an initially assigned cluster and shows its pre-fetched nodes', async () => {
    renderWithProviders(
      <DatacenterAssignmentTree state={INITIAL_WITH_PARIS} initialState={INITIAL_WITH_PARIS} onChange={vi.fn()} currentDcId="dc-1" />,
    )

    expect(await screen.findByText('pve1')).toBeInTheDocument()
    expect(screen.getByText('pve2')).toBeInTheDocument()
  })

  it('reports a node pick against the loaded node list', async () => {
    const onChange = vi.fn()

    renderWithProviders(
      <DatacenterAssignmentTree state={EMPTY} initialState={EMPTY} onChange={onChange} currentDcId="dc-1" />,
    )

    await screen.findByText('paris')
    fireEvent.click(screen.getAllByRole('button')[0])
    fireEvent.click(await screen.findByText('pve2'))

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const next = onChange.mock.calls[0][0] as AssignmentState

    expect([...next.nodes]).toEqual(['c1|pve2'])
    expect(next.clusters.size).toBe(0)
  })

  it('shows the empty state when the connections cannot be loaded', async () => {
    stubFetch(500)

    renderWithProviders(
      <DatacenterAssignmentTree state={EMPTY} initialState={EMPTY} onChange={vi.fn()} />,
    )

    expect(await screen.findByText('No PVE connection configured.')).toBeInTheDocument()
    expect(screen.queryByText('paris')).not.toBeInTheDocument()
  })
})
