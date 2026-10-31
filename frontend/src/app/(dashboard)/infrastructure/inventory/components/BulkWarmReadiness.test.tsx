/**
 * Component tests for the bulk dialog's warm node check (roadmap#174): one
 * warm-check per node of the batch, the launch held while a node is checked or
 * not ready, and "Prepare this node" re-checking the node once it succeeds.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import BulkWarmReadinessAlert, { installGuestConversion, useBulkWarmReadiness } from './BulkWarmReadiness'

const READY = { ok: true, missing: [], kind: 'vddk', vddkSetupAvailable: true }
const NO_VDDK = { ok: false, missing: ['nbdkit', 'vddk-lib'], kind: 'vddk', vddkSetupAvailable: true, error: 'VDDK warm-migration preflight failed' }

function Harness({ nodes, kind = 'vddk', conversion }: Readonly<{ nodes: string[]; kind?: 'nbd' | 'vddk'; conversion?: { enabled: boolean; guestsByNode: Record<string, { linux: boolean; windows: boolean }> } }>) {
  const readiness = useBulkWarmReadiness({ sourceConnectionId: 'vc', targetConnectionId: 'pve', nodes, kind, conversion })
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

  // roadmap#177: the confirmation says what lands where.
  it('confirms an OpenVDDK install into its own directory', async () => {
    mockPreflight({ pve1: { ...NO_VDDK, libdir: '/usr/lib/openvddk' } })

    renderWithProviders(<Harness nodes={['pve1']} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Prepare this node' }))
    expect(screen.getByText(/download OpenVDDK 0\.7\.4 \(Apache 2\.0, 17 MB\), check its SHA-256 and install it into \/usr\/lib\/openvddk/)).toBeTruthy()
    expect(screen.getByText(/A Broadcom VDDK already on the node is left untouched/)).toBeTruthy()
  })

  // Guest conversion switched on: a ready node that cannot convert the guests
  // landing on it holds the launch, like the single VM dialog.
  it('holds the launch when the conversion is on and the node cannot convert the guests it receives', async () => {
    const GC = { linux: ['virt-v2v-in-place (package virt-v2v)'], windows: ['the VirtIO drivers for Windows (/usr/share/virtio-win/virtio-win.iso)'] }
    mockPreflight({ pve1: { ...READY, guestConversion: GC } })

    renderWithProviders(<Harness nodes={['pve1']} conversion={{ enabled: true, guestsByNode: { pve1: { linux: true, windows: false } } }} />)

    const row = await screen.findByTestId('bulk-warm-conversion-pve1')
    expect(row.textContent).toContain('virt-v2v-in-place (package virt-v2v)')
    expect(row.textContent).not.toContain('VirtIO drivers')
    expect(screen.getByTestId('blocked').textContent).toBe('true')
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare this node' })).toBeNull()
  })

  it('does not hold the launch on conversion when the conversion is off', async () => {
    mockPreflight({ pve1: { ...READY, guestConversion: { linux: ['virt-v2v-in-place (package virt-v2v)'], windows: [] } } })

    renderWithProviders(<Harness nodes={['pve1']} conversion={{ enabled: false, guestsByNode: { pve1: { linux: true, windows: false } } }} />)

    await waitFor(() => expect(screen.getByTestId('blocked').textContent).toBe('false'))
    expect(screen.queryByTestId('bulk-warm-conversion-pve1')).toBeNull()
  })

  it('offers no preparation when the server says it cannot, only the guide', async () => {
    mockPreflight({ pve1: { ...NO_VDDK, vddkSetupAvailable: false } })

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
    mockPreflight({ pve1: { ok: false, missing: ['nbdinfo'], kind: 'nbd', vddkSetupAvailable: false } })

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

// Shared by the single VM and the bulk dialogs: what the node lacks for the
// guest conversion, installed through the existing preflight actions.
describe('installGuestConversion', () => {
  type Answer = Record<string, string | boolean>
  function mockActions(answers: Record<string, Answer[]>) {
    const seen: string[] = []
    server.use(http.post('*/api/v1/migrations/preflight', async ({ request }) => {
      const body: any = await request.json()
      seen.push(`${body.targetNode}:${body.action}`)
      const queue: Answer[] = answers[body.action] || [{}]
      const answer: Answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? {}
      return HttpResponse.json(answer)
    }))
    return seen
  }

  it('installs the packages only when only packages are missing', async () => {
    const seen = mockActions({ install: [{ success: true }] })
    await installGuestConversion('pve', 'pve2', ['virt-v2v-in-place (package virt-v2v)'])
    expect(seen).toEqual(['pve2:install'])
  })

  it('downloads the VirtIO drivers and waits for the background job', async () => {
    const seen = mockActions({ 'install-virtio-win': [{ started: true }], 'check-virtio-win': [{ done: true }] })
    await installGuestConversion('pve', 'pve2', ['the VirtIO drivers for Windows (/usr/share/virtio-win/virtio-win.iso)'])
    expect(seen).toEqual(['pve2:install-virtio-win', 'pve2:check-virtio-win'])
  }, 10_000)

  it('throws the reason when the package install fails', async () => {
    mockActions({ install: [{ success: false, error: 'apt: unable to locate virt-v2v' }] })
    await expect(installGuestConversion('pve', 'pve2', ['virt-v2v-in-place (package virt-v2v)'])).rejects.toThrow(/unable to locate virt-v2v/)
  })

  it('throws the reason when the drivers download fails', async () => {
    mockActions({ 'install-virtio-win': [{ started: true }], 'check-virtio-win': [{ done: true, error: 'download failed' }] })
    await expect(installGuestConversion('pve', 'pve2', ['the VirtIO drivers for Windows (x)'])).rejects.toThrow(/download failed/)
  }, 10_000)
})

