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
})
