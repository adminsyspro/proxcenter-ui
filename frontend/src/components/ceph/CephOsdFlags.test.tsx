/**
 * Component tests for CephOsdFlags.tsx.
 *
 * The panel tests use MSW for the initial flag load and flag mutations. The
 * dialog tests exercise the shared switch grid directly through its props.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/__tests__/setup/renderWithProviders'
import { HttpResponse, http, server } from '@/__tests__/setup/msw-server'

import { CephOsdFlagsDialog, CephOsdFlagsPanel } from './CephOsdFlags'

const CONN_ID = 'conn-1'
const FLAGS_URL = `*/api/v1/connections/${CONN_ID}/ceph/flags`
const DESCRIPTION = 'Cluster-wide OSD flags affect all OSDs. Use these to prevent data rebalancing during maintenance.'
const FLAG_NAMES = [
  'noout',
  'norebalance',
  'norecover',
  'noscrub',
  'nodeep-scrub',
  'nobackfill',
  'noup',
  'nodown',
] as const

function seedFlags(flags: string[] = []) {
  server.use(
    http.get(FLAGS_URL, () => HttpResponse.json({ data: { flags } })),
  )
}

function getFlagSwitch(flag: string) {
  return screen.getByRole('switch', { name: new RegExp(`^${flag}\\b`, 'i') })
}

async function waitForFlagsToLoad() {
  await waitFor(() => expect(getFlagSwitch('noout')).not.toBeDisabled())
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CephOsdFlagsPanel', () => {
  it('renders all eight unchecked switches and the description for an empty flag list', async () => {
    seedFlags()

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)

    expect(screen.getByText('OSD Flags')).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(8)
    await waitForFlagsToLoad()

    for (const flag of FLAG_NAMES) {
      expect(getFlagSwitch(flag)).not.toBeChecked()
    }
  })

  it('greys every switch out in read-only mode, while still showing the live state (#920)', async () => {
    seedFlags(['noout'])

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} readOnly />)
    await waitFor(() => expect(getFlagSwitch('noout')).toBeChecked())

    for (const flag of FLAG_NAMES) {
      expect(getFlagSwitch(flag)).toBeDisabled()
    }
  })

  it('checks only flags returned by the API', async () => {
    seedFlags(['noout'])

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await waitFor(() => expect(getFlagSwitch('noout')).toBeChecked())

    for (const flag of FLAG_NAMES.filter(flag => flag !== 'noout')) {
      expect(getFlagSwitch(flag)).not.toBeChecked()
    }
  })

  it('enables a flag with PUT and updates the switch after a successful response', async () => {
    seedFlags()
    let capturedMethod = ''
    let capturedBody: unknown
    server.use(
      http.put(FLAGS_URL, async ({ request }) => {
        capturedMethod = request.method
        capturedBody = await request.json()

        return HttpResponse.json({ data: null })
      }),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await waitForFlagsToLoad()
    fireEvent.click(getFlagSwitch('noout'))

    await waitFor(() => expect(getFlagSwitch('noout')).toBeChecked())
    expect(capturedMethod).toBe('PUT')
    expect(capturedBody).toEqual({ flag: 'noout' })
  })

  it('disables a flag with DELETE and updates the switch after a successful response', async () => {
    seedFlags(['noout'])
    let capturedMethod = ''
    let capturedBody: unknown
    server.use(
      http.delete(FLAGS_URL, async ({ request }) => {
        capturedMethod = request.method
        capturedBody = await request.json()

        return HttpResponse.json({ data: null })
      }),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await waitFor(() => expect(getFlagSwitch('noout')).toBeChecked())
    fireEvent.click(getFlagSwitch('noout'))

    await waitFor(() => expect(getFlagSwitch('noout')).not.toBeChecked())
    expect(capturedMethod).toBe('DELETE')
    expect(capturedBody).toEqual({ flag: 'noout' })
  })

  it.each([401, 403])('renders nothing when loading flags returns %s', async status => {
    server.use(
      http.get(FLAGS_URL, () => new HttpResponse(null, { status })),
    )
    const { container } = renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)

    await waitFor(() => expect(screen.queryByText('OSD Flags')).not.toBeInTheDocument())
    expect(container).toBeEmptyDOMElement()
  })

  it('does not bring the panel back when a denial arrives after unmounting', async () => {
    let releaseResponse = () => {}
    let markRequestStarted = () => {}
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
    const requestStarted = new Promise<void>(resolve => { markRequestStarted = resolve })
    server.use(
      http.get(FLAGS_URL, async () => {
        markRequestStarted()
        await responseGate

        return new HttpResponse(null, { status: 403 })
      }),
    )

    const { unmount } = renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await requestStarted
    unmount()
    releaseResponse()

    // Let the fetch continuation observe the effect cleanup's cancellation flag.
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.queryByText('OSD Flags')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('does not request flags when disabled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} enabled={false} />)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getAllByRole('switch')).toHaveLength(8)
  })

  it('does not request flags without a connection id', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    renderWithProviders(<CephOsdFlagsPanel connId={undefined} />)
    fireEvent.click(getFlagSwitch('noout'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getFlagSwitch('noout')).not.toBeChecked()
  })

  it('leaves a flag unchecked when PUT returns an error response', async () => {
    seedFlags()
    server.use(
      http.put(FLAGS_URL, () => new HttpResponse(null, { status: 500 })),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await waitForFlagsToLoad()
    fireEvent.click(getFlagSwitch('noout'))

    await waitFor(() => expect(getFlagSwitch('noout')).not.toBeDisabled())
    expect(getFlagSwitch('noout')).not.toBeChecked()
  })

  it.each([
    ['an error payload with no data', {}],
    ['a payload whose data carries no flag list', { data: {} }],
  ])('falls back to no flag posted for %s', async (_label, payload) => {
    server.use(
      http.get(FLAGS_URL, () => HttpResponse.json(payload)),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)
    await waitForFlagsToLoad()

    expect(screen.getByText('OSD Flags')).toBeInTheDocument()
    for (const flag of FLAG_NAMES) {
      expect(getFlagSwitch(flag)).not.toBeChecked()
    }
  })

  it('keeps the card and unchecked switches when the GET fails at network level', async () => {
    server.use(
      http.get(FLAGS_URL, () => HttpResponse.error()),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} />)

    await waitForFlagsToLoad()
    expect(screen.getByText('OSD Flags')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(8)
    for (const flag of FLAG_NAMES) {
      expect(getFlagSwitch(flag)).not.toBeChecked()
    }
  })
})

describe('CephOsdFlagsDialog', () => {
  it('renders its content, delegates switch changes, disables the toggling flag, and closes', () => {
    const onClose = vi.fn()
    const onToggle = vi.fn()

    renderWithProviders(
      <CephOsdFlagsDialog
        open
        onClose={onClose}
        flags={[]}
        loading={false}
        toggling='norebalance'
        onToggle={onToggle}
      />,
    )

    expect(screen.getByText('OSD Flags')).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(8)
    expect(getFlagSwitch('norebalance')).toBeDisabled()
    expect(getFlagSwitch('noout')).not.toBeDisabled()

    fireEvent.click(getFlagSwitch('noout'))
    expect(onToggle).toHaveBeenCalledWith('noout', true)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    renderWithProviders(
      <CephOsdFlagsDialog
        open={false}
        onClose={vi.fn()}
        flags={[]}
        loading={false}
        toggling={null}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.queryByText('OSD Flags')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  // ui#1164: the flags set on one host or one OSD, under the cluster grid.
  it('lists the per-host and per-OSD flags under the grid, removes a host flag, keeps OSD flags read-only', () => {
    const onToggleHost = vi.fn()

    renderWithProviders(
      <CephOsdFlagsDialog
        open
        onClose={vi.fn()}
        flags={[]}
        loading={false}
        toggling={null}
        onToggle={vi.fn()}
        hostFlags={{ pve3: ['noout'] }}
        osdFlags={{ 'osd.4': ['nodown'] }}
        onToggleHost={onToggleHost}
      />,
    )

    expect(screen.getByText('Cluster-wide')).toBeInTheDocument()
    expect(screen.getByText('Per host')).toBeInTheDocument()
    expect(screen.getByText(/Flags set on one CRUSH host or one OSD/)).toBeInTheDocument()

    expect(screen.getByTestId('ceph-flag-group-pve3')).toHaveTextContent('pve3noout')
    expect(screen.getByLabelText('noout is set on CRUSH host pve3 (ceph osd set-group)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove noout from pve3' }))
    expect(onToggleHost).toHaveBeenCalledWith('pve3', 'noout', false)

    expect(screen.getByTestId('ceph-flag-group-osd.4')).toHaveTextContent('osd.4nodown')
    expect(screen.getByLabelText('nodown set on osd.4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /osd\.4/ })).toBeNull()
  })

  it('hides the per-host block without scoped flags, and every write in read-only mode', () => {
    const { unmount } = renderWithProviders(
      <CephOsdFlagsDialog open onClose={vi.fn()} flags={[]} loading={false} toggling={null} onToggle={vi.fn()} hostFlags={{}} osdFlags={{}} onToggleHost={vi.fn()} />,
    )

    expect(screen.queryByText('Per host')).not.toBeInTheDocument()
    expect(screen.queryByText('Cluster-wide')).not.toBeInTheDocument()
    unmount()

    renderWithProviders(
      <CephOsdFlagsDialog open onClose={vi.fn()} flags={['noout']} loading={false} toggling={null} onToggle={vi.fn()} hostFlags={{ pve3: ['noout'] }} onToggleHost={vi.fn()} readOnly />,
    )

    expect(screen.getByTestId('ceph-flag-group-pve3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove noout from pve3' })).toBeNull()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
  })
})

/*
   ui#1164: with a host, the panel gets a second section for the four flags
   `ceph osd set-group` sets on that node alone.
*/
describe('CephOsdFlagsPanel with a host', () => {
  const seedScoped = (hostFlags: Record<string, string[]> = {}, osdFlags: Record<string, string[]> = {}, flags: string[] = []) =>
    server.use(http.get(FLAGS_URL, () => HttpResponse.json({ data: { flags, hostFlags, osdFlags } })))
  const hostSection = () => within(screen.getByTestId('ceph-flags-host'))
  const clusterSection = () => within(screen.getByTestId('ceph-flags-cluster'))
  const hostSwitch = (flag: string) => hostSection().getByRole('switch', { name: new RegExp(`^${flag}\\b`, 'i') })
  const clusterSwitch = (flag: string) => clusterSection().getByRole('switch', { name: new RegExp(`^${flag}\\b`, 'i') })
  const ownedState = () => ({
    flags: ['norebalance'],
    hostFlags: { pve3: ['noout'] },
    osdFlags: {},
    loading: false,
    toggling: null as string | null,
    forbidden: false,
    toggle: vi.fn(),
    toggleHost: vi.fn(),
  })

  it('adds a "This host" section with the four group flags, ON for the flags of the node\'s CRUSH host, matched on the first FQDN label', async () => {
    seedScoped({ 'PVE3.lab.local': ['noout', 'noin'] })

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} host='pve3' />)

    expect(screen.getByText('Cluster-wide')).toBeInTheDocument()
    expect(screen.getByText('This host (pve3)')).toBeInTheDocument()
    expect(screen.getByText(/only apply to the OSDs of this node/)).toBeInTheDocument()
    expect(clusterSection().getAllByRole('switch')).toHaveLength(8)
    expect(hostSection().getAllByRole('switch')).toHaveLength(4)
    expect(hostSection().getByText('Prevent OSDs from being marked in')).toBeInTheDocument()

    await waitFor(() => expect(hostSwitch('noout')).toBeChecked())
    expect(hostSwitch('noin')).toBeChecked()
    expect(hostSwitch('noup')).not.toBeChecked()
    expect(hostSwitch('nodown')).not.toBeChecked()

    // The host flag is not the cluster-wide one.
    expect(clusterSwitch('noout')).not.toBeChecked()
  })

  it('writes a host flag with {flag, host} on the CRUSH host name: PUT to set, DELETE to unset', async () => {
    seedScoped({ 'pve3.lab.local': ['noout'] })
    const calls: { method: string; body: unknown }[] = []
    const record = async ({ request }: { request: Request }) => {
      calls.push({ method: request.method, body: await request.json() })

      return HttpResponse.json({ success: true })
    }
    server.use(http.put(FLAGS_URL, record), http.delete(FLAGS_URL, record))

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} host='pve3' />)
    await waitFor(() => expect(hostSwitch('noout')).toBeChecked())

    fireEvent.click(hostSwitch('noup'))
    await waitFor(() => expect(hostSwitch('noup')).toBeChecked())
    fireEvent.click(hostSwitch('noout'))
    await waitFor(() => expect(hostSwitch('noout')).not.toBeChecked())

    expect(calls).toEqual([
      { method: 'PUT', body: { flag: 'noup', host: 'pve3.lab.local' } },
      { method: 'DELETE', body: { flag: 'noout', host: 'pve3.lab.local' } },
    ])
    // The cluster-wide grid did not move.
    expect(clusterSwitch('noup')).not.toBeChecked()
  })

  it('targets the node name when no CRUSH host carries a flag yet', async () => {
    seedScoped()
    let body: unknown
    server.use(
      http.put(FLAGS_URL, async ({ request }) => {
        body = await request.json()

        return HttpResponse.json({ success: true })
      }),
    )

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} host='pve2' />)
    await waitFor(() => expect(hostSwitch('noout')).not.toBeDisabled())
    fireEvent.click(hostSwitch('noout'))

    await waitFor(() => expect(hostSwitch('noout')).toBeChecked())
    expect(body).toEqual({ flag: 'noout', host: 'pve2' })
  })

  it('leaves a host flag in place when the server refuses', async () => {
    seedScoped({ pve3: ['noout'] })
    server.use(http.delete(FLAGS_URL, () => new HttpResponse(null, { status: 500 })))

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} host='pve3' />)
    await waitFor(() => expect(hostSwitch('noout')).toBeChecked())
    fireEvent.click(hostSwitch('noout'))

    await waitFor(() => expect(hostSwitch('noout')).not.toBeDisabled())
    expect(hostSwitch('noout')).toBeChecked()
  })

  it('greys the twelve switches out in read-only mode', async () => {
    seedScoped({ pve3: ['noout'] })

    renderWithProviders(<CephOsdFlagsPanel connId={CONN_ID} host='pve3' readOnly />)
    await waitFor(() => expect(hostSwitch('noout')).toBeChecked())

    expect(screen.getAllByRole('switch')).toHaveLength(12)
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
  })

  it('runs on a state owned by the caller without loading anything itself', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const state = ownedState()

    renderWithProviders(<CephOsdFlagsPanel state={state} host='pve3' />)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(clusterSwitch('norebalance')).toBeChecked()
    expect(hostSwitch('noout')).toBeChecked()

    fireEvent.click(hostSwitch('nodown'))
    expect(state.toggleHost).toHaveBeenCalledWith('pve3', 'nodown', true)
    fireEvent.click(clusterSwitch('noout'))
    expect(state.toggle).toHaveBeenCalledWith('noout', true)
  })

  it('disables only the host switch being written', () => {
    renderWithProviders(<CephOsdFlagsPanel state={{ ...ownedState(), toggling: 'pve3:noout' }} host='pve3' />)

    expect(hostSwitch('noout')).toBeDisabled()
    expect(hostSwitch('noin')).not.toBeDisabled()
    expect(clusterSwitch('noout')).not.toBeDisabled()
  })

  it('shows nothing when the caller\'s state was denied', () => {
    const { container } = renderWithProviders(<CephOsdFlagsPanel state={{ ...ownedState(), forbidden: true }} host='pve3' />)

    expect(container).toBeEmptyDOMElement()
  })
})
