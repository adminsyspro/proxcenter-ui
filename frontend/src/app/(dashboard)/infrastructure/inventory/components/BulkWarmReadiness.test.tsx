/**
 * Component tests for the bulk dialog's warm node check (roadmap#174): one
 * warm-check per node of the batch, the launch held while a node is checked or
 * not ready, and "Prepare this node" re-checking the node once it succeeds.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import BulkWarmReadinessAlert, { useBulkWarmReadiness } from './BulkWarmReadiness'

const READY = { ok: true, missing: [], kind: 'vddk', vddkTokenConfigured: true }
const NO_VDDK = { ok: false, missing: ['nbdkit', 'vddk-lib'], kind: 'vddk', vddkTokenConfigured: true, error: 'VDDK warm-migration preflight failed' }

function Harness({ nodes, kind = 'vddk' }: Readonly<{ nodes: string[]; kind?: 'nbd' | 'vddk' }>) {
  const readiness = useBulkWarmReadiness({ sourceConnectionId: 'vc', targetConnectionId: 'pve', nodes, kind })
  return (
    <>
      <span data-testid="blocked">{String(readiness.blocked)}</span>
      <BulkWarmReadinessAlert readiness={readiness} />
    </>
  )
}

/** Answers warm-check per node from `answers`, and records the bodies it saw. */
function mockPreflight(answers: Record<string, Record<string, unknown>>, seen: any[] = []) {
  server.use(http.post('*/api/v1/migrations/preflight', async ({ request }) => {
    const body: any = await request.json()
    seen.push(body)
    return HttpResponse.json(answers[body.targetNode])
  }))
  return seen
}

afterEach(() => {
  cleanup()
})

describe('BulkWarmReadiness', () => {
  it('checks every node once with the source, and releases the launch when all are ready', async () => {
    const seen = mockPreflight({ pve1: READY, pve2: READY })

    renderWithProviders(<Harness nodes={['pve1', 'pve2']} />)

    await waitFor(() => expect(screen.getByTestId('blocked').textContent).toBe('false'))
    expect(seen).toEqual([
      { targetConnectionId: 'pve', targetNode: 'pve1', action: 'warm-check', sourceConnectionId: 'vc' },
      { targetConnectionId: 'pve', targetNode: 'pve2', action: 'warm-check', sourceConnectionId: 'vc' },
    ])
    expect(screen.queryByTestId('bulk-warm-not-ready')).toBeNull()
  })

  it('holds the launch and says so while a node is being checked', async () => {
    server.use(http.post('*/api/v1/migrations/preflight', () => new Promise(() => {})))

    renderWithProviders(<Harness nodes={['pve1']} />)

    expect(await screen.findByTestId('bulk-warm-checking')).toBeTruthy()
    expect(screen.getByTestId('blocked').textContent).toBe('true')
  })

  it('names the unprepared node, what it misses, and prepares it then checks it again', async () => {
    let prepared = false
    server.use(
      http.post('*/api/v1/migrations/preflight', () => HttpResponse.json(prepared ? READY : NO_VDDK)),
      http.post('*/api/v1/migrations/warm-node-setup', async ({ request }) => {
        expect(await request.json()).toEqual({ targetConnectionId: 'pve', targetNode: 'pve1-dr' })
        prepared = true
        return HttpResponse.json({ ok: true, missing: [] })
      }),
    )

    renderWithProviders(<Harness nodes={['pve1-dr']} />)

    expect(await screen.findByText('pve1-dr is not ready for warm migration')).toBeTruthy()
    expect(screen.getByText('Missing on the node: nbdkit, vddk-lib.')).toBeTruthy()
    expect(screen.getByTestId('blocked').textContent).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Prepare this node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare the node' }))

    await waitFor(() => expect(screen.getByTestId('blocked').textContent).toBe('false'))
    expect(screen.queryByTestId('bulk-warm-not-ready')).toBeNull()
  })

  it('cancels the confirmation without preparing anything', async () => {
    mockPreflight({ pve1: NO_VDDK })

    renderWithProviders(<Harness nodes={['pve1']} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Prepare this node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Prepare this node' })).toBeTruthy()
  })

  it('shows why the preparation failed and keeps the launch held', async () => {
    mockPreflight({ pve1: NO_VDDK })
    server.use(http.post('*/api/v1/migrations/warm-node-setup', () => HttpResponse.json({ ok: false, missing: ['vddk-lib'] })))

    renderWithProviders(<Harness nodes={['pve1']} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Prepare this node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare the node' }))

    expect(await screen.findByText('Node preparation failed: vddk-lib')).toBeTruthy()
    expect(screen.getByTestId('blocked').textContent).toBe('true')
  })

  it('offers no preparation without the VDDK package, only the guide', async () => {
    mockPreflight({ pve1: { ...NO_VDDK, vddkTokenConfigured: false } })

    renderWithProviders(<Harness nodes={['pve1']} />)

    expect(await screen.findByText('pve1 is not ready for warm migration')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare this node' })).toBeNull()
    expect(screen.getByRole('link', { name: 'warm migration node setup guide' })).toBeTruthy()
  })

  it('explains a node older than Proxmox VE 9 instead of offering to prepare it', async () => {
    mockPreflight({ pve1: { ...NO_VDDK, osUnsupported: true, debianMajor: 12 } })

    renderWithProviders(<Harness nodes={['pve1']} />)

    expect(await screen.findByText(/This node runs Proxmox VE 8 \(Debian 12\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare this node' })).toBeNull()
  })

  it('reports a source the node VDDK cannot read', async () => {
    mockPreflight({ pve1: { ...READY, ok: false, source: { sourceVersion: '5.5.0', minVersion: '7.0', absoluteMin: '6.5', blocked: true } } })

    renderWithProviders(<Harness nodes={['pve1']} />)

    expect(await screen.findByText(/The source runs vSphere 5\.5\.0/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare this node' })).toBeNull()
  })

  it('gives the apt hint for an XCP-ng source', async () => {
    mockPreflight({ pve1: { ok: false, missing: ['nbdinfo'], kind: 'nbd', vddkTokenConfigured: false } })

    renderWithProviders(<Harness nodes={['pve1']} kind="nbd" />)

    expect(await screen.findByText(/apt install nbdkit nbd-client libnbd-bin/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'warm migration node setup guide' })).toBeNull()
  })

  it('holds the launch when the check cannot be read', async () => {
    server.use(http.post('*/api/v1/migrations/preflight', () => HttpResponse.error()))

    renderWithProviders(<Harness nodes={['pve1']} />)

    expect(await screen.findByText('pve1 is not ready for warm migration')).toBeTruthy()
    expect(screen.getByTestId('blocked').textContent).toBe('true')
  })

  it('checks nothing and holds nothing for a batch that is not warm', () => {
    renderWithProviders(<Harness nodes={[]} />)

    expect(screen.getByTestId('blocked').textContent).toBe('false')
    expect(screen.queryByTestId('bulk-warm-checking')).toBeNull()
  })
})
