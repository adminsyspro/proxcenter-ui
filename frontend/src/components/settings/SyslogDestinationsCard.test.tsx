/**
 * The syslog destinations card (issue #184): what the operator sees of the
 * collectors and what actually reaches the settings routes. Every assertion
 * goes through the DOM, and the PUT and POST bodies the card sends are read
 * back from the fetch mock, never from component state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, within, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { SyslogDestination, SyslogDestinationStatus } from '@/lib/syslog/types'

import SyslogDestinationsCard from './SyslogDestinationsCard'

const API = '/api/v1/settings/syslog'

function destination(over: Partial<SyslogDestination> = {}): SyslogDestination {
  return {
    id: 'd1',
    name: 'SIEM A',
    enabled: true,
    host: 'siem.lan',
    port: 514,
    transport: 'udp',
    format: 'rfc5424',
    framing: 'newline',
    facility: 13,
    categories: [],
    tls: { verify: true, ca: '', serverName: '' },
    ...over,
  }
}

function destinationStatus(over: Partial<SyslogDestinationStatus> = {}): SyslogDestinationStatus {
  return { connected: false, sent: 0, dropped: 0, failed: 0, lastSentAt: null, lastError: null, lastErrorAt: null, ...over }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Handler = (body: any) => Response | Promise<Response>

// The route answers a PUT with the stored config; ids are assigned server side.
const echoPut = (body: any) =>
  json({
    destinations: body.destinations.map((d: SyslogDestination, i: number) => ({ ...d, id: d.id || `new-${i}` })),
    status: {},
  })

function mockFetch(payload: unknown, handlers: { put?: Handler; post?: Handler } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined

      if (init?.method === 'PUT') return (handlers.put ?? echoPut)(body)
      if (init?.method === 'POST') return (handlers.post ?? (() => json({ ok: true })))(body)

      return json(payload)
    }),
  )
}

const requests = (method: string) =>
  (globalThis.fetch as any).mock.calls
    .filter((c: any[]) => c[1]?.method === method)
    .map((c: any[]) => ({ url: c[0] as string, body: JSON.parse(String(c[1].body)) }))

// A response the test releases by hand, to look at the card while a request is in flight.
function deferred() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>(r => {
    resolve = r
  })

  return { promise, resolve }
}

// renderWithProviders pins revalidateOnMount to false; this card is all about
// what it loads, so the nested config turns it back on for these tests only.
function renderCard() {
  return renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <SyslogDestinationsCard />
    </SWRConfig>,
  )
}

const addButton = () => screen.getByRole('button', { name: 'Add destination' })
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement

// A small MUI Select carries no accessible name of its own: reach it through
// the label of its FormControl.
function combobox(label: string) {
  const control = screen.getByText(label, { selector: 'label' }).closest('.MuiFormControl-root') as HTMLElement

  return control.querySelector('[role="combobox"]') as HTMLElement
}

async function pick(label: string, option: string) {
  fireEvent.mouseDown(combobox(label))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

async function openAddDialog() {
  await waitFor(() => expect(addButton()).toBeEnabled())
  fireEvent.click(addButton())

  return screen.findByRole('dialog')
}

async function openEditDialog(name: string) {
  await screen.findByText(name)
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'Edit' }))

  return screen.findByRole('dialog')
}

function fillRequired(name = 'Splunk', host = 'siem.lan') {
  fireEvent.change(field(/^Name/), { target: { value: name } })
  fireEvent.change(field(/^Host/), { target: { value: host } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SyslogDestinationsCard list', () => {
  it('shows placeholders and keeps the add button disabled while the destinations load', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderCard()

    expect(addButton()).toBeDisabled()
    expect(document.querySelectorAll('.MuiSkeleton-root')).toHaveLength(2)
  })

  it('says so when no destination exists yet', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()

    expect(await screen.findByText(/^No destination yet\./)).toBeInTheDocument()
    expect(addButton()).toBeEnabled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('surfaces a load failure with what the route answered and blocks adding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    renderCard()

    expect(await screen.findByText('Unable to load the syslog destinations. nope')).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    expect(screen.queryByText(/^No destination yet/)).not.toBeInTheDocument()
  })

  it('still reports a load failure that carries no message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('')
      }),
    )
    renderCard()

    expect(await screen.findByText(/^Unable to load the syslog destinations\./)).toBeInTheDocument()
  })

  it('renders every destination with its collector, format, categories and activity', async () => {
    const sentAt = '2026-09-17T08:00:00.000Z'
    const longError = 'x'.repeat(100)

    mockFetch({
      destinations: [
        destination({ id: 'd1', name: 'SIEM A' }),
        destination({
          id: 'd2',
          name: 'SIEM B',
          host: '10.0.0.5',
          port: 6514,
          transport: 'tls',
          format: 'cef',
          categories: ['auth', 'vms'],
        }),
        destination({ id: 'd3', name: 'SIEM C', transport: 'tcp', format: 'rfc3164' }),
        destination({ id: 'd4', name: 'SIEM D', enabled: false }),
        destination({ id: 'd5', name: 'SIEM E' }),
        destination({ id: 'd6', name: 'SIEM F' }),
        destination({ id: 'd7', name: 'SIEM G' }),
        destination({ id: 'd8', name: 'SIEM H' }),
        destination({ id: 'd9', name: 'SIEM I' }),
      ],
      status: {
        d1: destinationStatus({ sent: 3, lastSentAt: sentAt }),
        // An error older than the last delivery is history, not the current state.
        d2: destinationStatus({
          sent: 5,
          dropped: 2,
          lastSentAt: sentAt,
          lastErrorAt: '2026-09-17T07:00:00.000Z',
          lastError: 'old failure',
        }),
        d3: destinationStatus({ sent: 1, lastSentAt: sentAt, lastErrorAt: '2026-09-17T09:00:00.000Z', lastError: longError }),
        d4: destinationStatus({ sent: 9 }),
        d5: destinationStatus(),
        d6: destinationStatus({ lastError: 'connection refused', lastErrorAt: sentAt }),
        d7: destinationStatus({ sent: 2 }),
        d9: destinationStatus({ sent: 4, lastSentAt: sentAt, lastErrorAt: '2026-09-17T09:00:00.000Z' }),
      },
    })
    renderCard()

    await screen.findByText('SIEM A')

    const a = within(rowOf('SIEM A'))

    expect(a.getByText('siem.lan:514')).toBeInTheDocument()
    expect(a.getByText('UDP')).toBeInTheDocument()
    expect(a.getByText('RFC 5424')).toBeInTheDocument()
    expect(a.getByText('All categories')).toBeInTheDocument()
    expect(a.getByText(/^Last sent .+ · 3 sent$/)).toBeInTheDocument()
    expect(a.getByRole('switch')).toBeChecked()

    const b = within(rowOf('SIEM B'))

    expect(b.getByText('10.0.0.5:6514')).toBeInTheDocument()
    expect(b.getByText('TLS')).toBeInTheDocument()
    expect(b.getByText('CEF')).toBeInTheDocument()
    expect(b.getByText('2 categories')).toBeInTheDocument()
    expect(b.getByText(/^Last sent .+ · 5 sent · 2 dropped$/)).toBeInTheDocument()

    const c = within(rowOf('SIEM C'))

    expect(c.getByText('TCP')).toBeInTheDocument()
    expect(c.getByText('RFC 3164 (BSD)')).toBeInTheDocument()
    // A long error is cut to 80 characters so the row stays one line.
    expect(c.getByText(`Last error: ${'x'.repeat(79)}… · 1 sent`)).toBeInTheDocument()

    const d = within(rowOf('SIEM D'))

    expect(d.getByText('Disabled')).toBeInTheDocument()
    expect(d.getByRole('switch')).not.toBeChecked()

    expect(within(rowOf('SIEM E')).getByText('Nothing sent yet')).toBeInTheDocument()
    expect(within(rowOf('SIEM F')).getByText('Last error: connection refused · 0 sent')).toBeInTheDocument()
    expect(within(rowOf('SIEM G')).getByText('2 sent')).toBeInTheDocument()
    expect(within(rowOf('SIEM H')).getByText('Nothing sent yet')).toBeInTheDocument()
    expect(within(rowOf('SIEM I')).getByText(/^Last sent .+ · 4 sent$/)).toBeInTheDocument()
  })

  it('blocks adding once the destination limit is reached', async () => {
    mockFetch({ destinations: [destination()], status: {}, limits: { maxDestinations: 1 } })
    renderCard()

    await screen.findByText('SIEM A')
    expect(addButton()).toBeDisabled()
  })

  it('flips a destination off in place and confirms the save', async () => {
    mockFetch({ destinations: [destination(), destination({ id: 'd2', name: 'SIEM B', enabled: false })], status: {} })
    renderCard()

    await screen.findByText('SIEM A')
    fireEvent.click(within(rowOf('SIEM A')).getByRole('switch'))

    expect(await screen.findByText('Syslog destinations saved')).toBeInTheDocument()

    const [put] = requests('PUT')

    expect(put.url).toBe(API)
    expect(put.body.destinations.map((d: SyslogDestination) => [d.id, d.enabled])).toEqual([
      ['d1', false],
      ['d2', false],
    ])

    // The list now shows what the route stored.
    expect(within(rowOf('SIEM A')).getByRole('switch')).not.toBeChecked()
    expect(within(rowOf('SIEM A')).getByText('Disabled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Syslog destinations saved')).not.toBeInTheDocument()
  })

  it('asks for confirmation before removing a destination and writes the list without it', async () => {
    mockFetch({ destinations: [destination(), destination({ id: 'd2', name: 'SIEM B' })], status: {} })
    renderCard()

    await screen.findByText('SIEM A')
    fireEvent.click(within(rowOf('SIEM A')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Remove this destination?')).toBeInTheDocument()
    expect(screen.getByText(/^SIEM A stops receiving audit entries immediately\./)).toBeInTheDocument()

    // Backing out, whichever way, writes nothing.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Remove this destination?')).not.toBeInTheDocument())

    fireEvent.click(within(rowOf('SIEM A')).getByRole('button', { name: 'Delete' }))
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Remove this destination?')).not.toBeInTheDocument())

    fireEvent.click(within(rowOf('SIEM A')).getByRole('button', { name: 'Delete' }))
    const closeGlyph = (await screen.findByRole('dialog')).querySelector('.ri-close-line') as HTMLElement

    fireEvent.click(closeGlyph)
    await waitFor(() => expect(screen.queryByText('Remove this destination?')).not.toBeInTheDocument())
    expect(requests('PUT')).toHaveLength(0)

    fireEvent.click(within(rowOf('SIEM B')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Remove this destination?')).not.toBeInTheDocument())

    expect(requests('PUT')[0].body.destinations.map((d: SyslogDestination) => d.id)).toEqual(['d1'])
    expect(screen.getByText('SIEM A')).toBeInTheDocument()
    expect(screen.queryByText('SIEM B')).not.toBeInTheDocument()
  })

  it('keeps the confirmation open and reports the failure when the removal is refused', async () => {
    mockFetch({ destinations: [destination()], status: {} }, { put: () => new Response('', { status: 500 }) })
    renderCard()

    await screen.findByText('SIEM A')
    fireEvent.click(within(rowOf('SIEM A')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Save failed: HTTP 500')).toBeInTheDocument()
    expect(screen.getByText('Remove this destination?')).toBeInTheDocument()
    expect(screen.getByText('SIEM A')).toBeInTheDocument()
  })
})

describe('SyslogDestinationsCard dialog', () => {
  it('opens on the defaults of a new destination', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    expect(within(dialog).getByText('New syslog destination')).toBeInTheDocument()
    expect(field(/^Name/)).toHaveValue('')
    expect(field(/^Host/)).toHaveValue('')
    expect(field(/^Port/)).toHaveValue(514)
    expect(combobox('Transport')).toHaveTextContent('UDP')
    expect(combobox('Format')).toHaveTextContent('RFC 5424')
    expect(combobox('Facility')).toHaveTextContent('log audit (13)')
    expect(combobox('Audit categories')).toHaveTextContent('All categories')
    expect(screen.getByText(/^No delivery confirmation/)).toBeInTheDocument()
    // UDP has neither framing nor TLS settings.
    expect(screen.queryByText('Framing', { selector: 'label' })).not.toBeInTheDocument()
    expect(screen.queryByText('Verify the collector certificate')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('switch')).toBeChecked()
  })

  it('refuses to save or test a destination without a name and a host', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    expect(field(/^Name/)).toHaveAttribute('aria-invalid', 'false')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(field(/^Name/)).toHaveAttribute('aria-invalid', 'true')
    expect(field(/^Host/)).toHaveAttribute('aria-invalid', 'true')
    expect(requests('PUT')).toHaveLength(0)

    fireEvent.change(field(/^Name/), { target: { value: 'Splunk' } })
    expect(field(/^Name/)).toHaveAttribute('aria-invalid', 'false')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))
    expect(requests('POST')).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('moves the default port with the transport, keeps a typed one, and shows framing and TLS for stream transports only', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    await openAddDialog()

    await pick('Transport', 'TLS')
    expect(field(/^Port/)).toHaveValue(6514)
    expect(screen.getByText(/^Encrypted, the collector certificate is verified/)).toBeInTheDocument()
    expect(combobox('Framing')).toHaveTextContent('Newline delimited')
    expect(screen.getByText('Verify the collector certificate')).toBeInTheDocument()

    await pick('Transport', 'TCP')
    expect(field(/^Port/)).toHaveValue(514)
    expect(screen.getByText('Reliable, not encrypted.')).toBeInTheDocument()
    expect(combobox('Framing')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Verify the collector certificate')).not.toBeInTheDocument())

    fireEvent.change(field(/^Port/), { target: { value: '1514' } })
    await pick('Transport', 'TLS')
    expect(field(/^Port/)).toHaveValue(1514)

    await pick('Transport', 'UDP')
    expect(field(/^Port/)).toHaveValue(1514)
    expect(screen.queryByText('Framing', { selector: 'label' })).not.toBeInTheDocument()
  })

  it('saves a TLS destination with its framing, certificate settings and state, warning when verification is off', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired('Wazuh', ' wazuh.lan ')
    await pick('Transport', 'TLS')
    await pick('Framing', 'Octet counting (RFC 5425, syslog-ng)')
    expect(combobox('Framing')).toHaveTextContent('Octet counting')

    expect(screen.queryByText(/anyone on the path can impersonate/)).not.toBeInTheDocument()

    const [verify, enabled] = within(dialog).getAllByRole('switch')

    fireEvent.click(verify)
    expect(await screen.findByText(/anyone on the path can impersonate/)).toBeInTheDocument()
    fireEvent.change(field(/^Server name/), { target: { value: 'wazuh.internal' } })
    fireEvent.change(field(/^CA certificate/), { target: { value: '-----BEGIN CERTIFICATE-----\nabc' } })
    fireEvent.click(enabled)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(requests('PUT')[0].body.destinations).toEqual([
      expect.objectContaining({
        id: '',
        name: 'Wazuh',
        host: 'wazuh.lan',
        port: 6514,
        transport: 'tls',
        framing: 'octet-counting',
        enabled: false,
        tls: { verify: false, ca: '-----BEGIN CERTIFICATE-----\nabc', serverName: 'wazuh.internal' },
      }),
    ])

    // The list shows what the route stored.
    expect(await screen.findByText('Wazuh')).toBeInTheDocument()
    expect(screen.getByText('wazuh.lan:6514')).toBeInTheDocument()
    expect(screen.getByText('Syslog destinations saved')).toBeInTheDocument()
  })

  it('saves the format, facility and category filter picked in the dialog', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    await pick('Format', 'CEF')
    await pick('Facility', 'local0 (16)')

    fireEvent.mouseDown(combobox('Audit categories'))
    const auth = await screen.findByRole('option', { name: 'Authentication' })

    fireEvent.click(auth)
    fireEvent.click(screen.getByRole('option', { name: 'VMs' }))
    fireEvent.keyDown(auth, { key: 'Escape' })
    expect(combobox('Audit categories')).toHaveTextContent('Authentication, VMs')
    expect(combobox('Format')).toHaveTextContent('CEF')
    expect(combobox('Facility')).toHaveTextContent('local0 (16)')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(requests('PUT')[0].body.destinations[0]).toMatchObject({ format: 'cef', facility: 16, categories: ['auth', 'vms'] })
    expect(await screen.findByText('2 categories')).toBeInTheDocument()
    expect(screen.getByText('CEF')).toBeInTheDocument()
  })

  it('edits a destination in place: prefilled, trimmed, written back under the same id', async () => {
    mockFetch({
      destinations: [
        destination(),
        destination({
          id: 'd2',
          name: 'SIEM B',
          host: '10.0.0.5',
          port: 6514,
          transport: 'tls',
          framing: 'octet-counting',
          categories: ['auth'],
          tls: { verify: true, ca: 'PEM', serverName: 'siem.internal' },
        }),
      ],
      status: {},
    })
    renderCard()
    const dialog = await openEditDialog('SIEM B')

    expect(within(dialog).getByText('Edit syslog destination')).toBeInTheDocument()
    expect(field(/^Name/)).toHaveValue('SIEM B')
    expect(field(/^Host/)).toHaveValue('10.0.0.5')
    expect(field(/^Port/)).toHaveValue(6514)
    expect(combobox('Transport')).toHaveTextContent('TLS')
    expect(combobox('Framing')).toHaveTextContent('Octet counting')
    expect(combobox('Audit categories')).toHaveTextContent('Authentication')
    expect(field(/^Server name/)).toHaveValue('siem.internal')
    expect(field(/^CA certificate/)).toHaveValue('PEM')

    fireEvent.change(field(/^Name/), { target: { value: '  SIEM B2  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(requests('PUT')[0].body.destinations.map((d: SyslogDestination) => [d.id, d.name])).toEqual([
      ['d1', 'SIEM A'],
      ['d2', 'SIEM B2'],
    ])
    expect(await screen.findByText('SIEM B2')).toBeInTheDocument()
  })

  it('keeps the dialog open and reports the reason when the route refuses the save', async () => {
    mockFetch({ destinations: [], status: {} }, { put: () => json({ error: 'host is not resolvable' }, 400) })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Save failed: host is not resolvable')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(field(/^Name/)).toHaveValue('Splunk')
  })

  it('shows the save in progress and closes once the route has answered', async () => {
    const put = deferred()

    mockFetch({ destinations: [], status: {} }, { put: () => put.promise })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Send test' })).toBeDisabled()

    put.resolve(echoPut(requests('PUT')[0].body))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Splunk')).toBeInTheDocument()
  })

  it('cancels without writing anything', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests('PUT')).toHaveLength(0)
  })
})

describe('SyslogDestinationsCard send test', () => {
  it('posts the form as typed and, over UDP, says the datagram left without confirmation', async () => {
    mockFetch({ destinations: [], status: {} })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired('Splunk', 'siem.lan')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await screen.findByText(/^Test datagram sent to siem\.lan:514\. UDP gives no delivery confirmation/)).toBeInTheDocument()

    const [post] = requests('POST')

    expect(post.url).toBe(`${API}/test`)
    expect(post.body).toMatchObject({ name: 'Splunk', host: 'siem.lan', port: 514, transport: 'udp' })
    expect(requests('PUT')).toHaveLength(0)
  })

  it('confirms a delivered line over a stream transport and shows what was sent', async () => {
    mockFetch(
      { destinations: [], status: {} },
      { post: () => json({ ok: true, message: '<110>1 2026-09-17T08:00:00Z proxcenter audit - - test' }) },
    )
    renderCard()
    const dialog = await openAddDialog()

    fillRequired('Graylog', 'graylog.lan')
    await pick('Transport', 'TCP')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await screen.findByText('Test line delivered to graylog.lan:514')).toBeInTheDocument()
    expect(screen.getByText('<110>1 2026-09-17T08:00:00Z proxcenter audit - - test')).toBeInTheDocument()
    expect(requests('POST')[0].body).toMatchObject({ host: 'graylog.lan', transport: 'tcp', port: 514 })
  })

  it('reports a refused test with the collector error, and the alert can be dismissed', async () => {
    mockFetch({ destinations: [], status: {} }, { post: () => json({ ok: false, error: 'ECONNREFUSED 10.0.0.5:514' }) })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await screen.findByText('Test failed: ECONNREFUSED 10.0.0.5:514')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/^Test failed/)).not.toBeInTheDocument()
  })

  it('reports a test the route itself rejected', async () => {
    mockFetch({ destinations: [], status: {} }, { post: () => json({ error: 'forbidden' }, 403) })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await screen.findByText('Test failed: forbidden')).toBeInTheDocument()
  })

  it('does not invent an error when the route reports a failure without one', async () => {
    mockFetch({ destinations: [], status: {} }, { post: () => json({ ok: false }) })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await screen.findByText('Test failed:')).toBeInTheDocument()
  })

  it('shows the test in flight and disables it until the route answers', async () => {
    const post = deferred()

    mockFetch({ destinations: [], status: {} }, { post: () => post.promise })
    renderCard()
    const dialog = await openAddDialog()

    fillRequired()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))
    expect(await within(dialog).findByRole('button', { name: 'Sending...' })).toBeDisabled()
    // Saving stays possible while a test runs.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()

    post.resolve(json({ ok: true }))
    expect(await within(dialog).findByRole('button', { name: 'Send test' })).toBeEnabled()
    expect(screen.getByText(/^Test datagram sent/)).toBeInTheDocument()
  })
})
