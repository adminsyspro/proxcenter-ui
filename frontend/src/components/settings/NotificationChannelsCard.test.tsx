/**
 * The notification channels card (roadmap#47): what the operator sees of the
 * channels and what reaches the relay routes. Secrets are checked one way
 * only: the row shows the masked URL, the edit form starts blank, and the
 * create body carries the typed URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, within, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { NotificationChannel } from '@/lib/notifications/channels'

import NotificationChannelsCard from './NotificationChannelsCard'

const API = '/api/v1/orchestrator/notifications/channels'

function channel(over: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'c1',
    name: 'Ops Slack',
    type: 'slack',
    enabled: true,
    url_masked: 'https://hooks.slack.com/services/***',
    has_secret: false,
    has_header_value: false,
    header_name: '',
    types: ['alert'],
    min_severity: 'warning',
    allow_private_network: false,
    last_status: '',
    last_error: '',
    last_sent_at: null,
    last_error_at: null,
    sent_count: 0,
    failed_count: 0,
    ...over,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Handler = (body: any, url: string) => Response | Promise<Response>

function mockFetch(channels: NotificationChannel[], handlers: { put?: Handler; post?: Handler; del?: Handler } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined

      if (init?.method === 'PUT') return (handlers.put ?? (() => json(channel())))(body, url)
      if (init?.method === 'POST') return (handlers.post ?? (() => json(channel(), 201)))(body, url)
      if (init?.method === 'DELETE') return (handlers.del ?? (() => json({ status: 'deleted' })))(body, url)

      return json({ data: channels })
    }),
  )
}

const requests = (method: string) =>
  (globalThis.fetch as any).mock.calls
    .filter((c: any[]) => c[1]?.method === method)
    .map((c: any[]) => ({ url: c[0] as string, body: c[1].body ? JSON.parse(String(c[1].body)) : undefined }))

function renderCard() {
  return renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <NotificationChannelsCard />
    </SWRConfig>,
  )
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotificationChannelsCard', () => {
  it('lists the channels with the masked URL, the filters and the delivery state', async () => {
    mockFetch([
      channel(),
      channel({
        id: 'c2',
        name: 'NOC Teams',
        type: 'teams',
        types: [],
        min_severity: 'critical',
        last_status: 'failed',
        last_error: 'HTTP 400: The input body for trigger is invalid',
      }),
    ])
    renderCard()

    const slack = await waitFor(() => rowOf('Ops Slack'))

    expect(within(slack).getByText('https://hooks.slack.com/services/***')).toBeInTheDocument()
    expect(within(slack).getByText('Alerts · Warnings and critical')).toBeInTheDocument()
    expect(within(slack).getByText('Nothing sent yet')).toBeInTheDocument()

    const teams = rowOf('NOC Teams')

    expect(within(teams).getByText('All types · Critical only')).toBeInTheDocument()
    expect(within(teams).getByText('Last error: HTTP 400: The input body for trigger is invalid')).toBeInTheDocument()
  })

  it('shows the empty state when there is no channel', async () => {
    mockFetch([])
    renderCard()

    expect(await screen.findByText('No channel yet. Email stays the only recipient until one is added.')).toBeInTheDocument()
  })

  it('creates a channel with the typed URL and the chosen filters', async () => {
    mockFetch([])
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: 'Add channel' }))

    const dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ops' } })
    fireEvent.change(within(dialog).getByLabelText(/^URL/), { target: { value: 'https://hooks.slack.com/services/T/B/secret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('POST')).toHaveLength(1))

    const [{ url, body }] = requests('POST')

    expect(url).toBe(API)
    expect(body).toMatchObject({
      name: 'Ops',
      type: 'slack',
      enabled: true,
      url: 'https://hooks.slack.com/services/T/B/secret',
      types: [],
      min_severity: 'warning',
      allow_private_network: false,
    })
  })

  it('refuses to save a new channel without a URL', async () => {
    mockFetch([])
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: 'Add channel' }))

    const dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ops' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(requests('POST')).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('edits a channel with a blank URL so the stored one is kept', async () => {
    mockFetch([channel()])
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog')
    const urlField = within(dialog).getByLabelText(/^URL/) as HTMLInputElement

    expect(urlField.value).toBe('')
    expect(urlField.placeholder).toBe('https://hooks.slack.com/services/***')
    expect(within(dialog).getByText('Leave blank to keep https://hooks.slack.com/services/***')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ops 2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('PUT')).toHaveLength(1))

    const [{ url, body }] = requests('PUT')

    expect(url).toBe(`${API}/c1`)
    expect(body).toMatchObject({ name: 'Ops 2', url: '', type: 'slack', types: ['alert'], min_severity: 'warning' })
  })

  it('toggles a channel through a PUT that keeps the URL blank', async () => {
    mockFetch([channel()])
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(row.querySelector('input[type="checkbox"]') as HTMLInputElement)

    await waitFor(() => expect(requests('PUT')).toHaveLength(1))
    expect(requests('PUT')[0].body).toMatchObject({ enabled: false, url: '', name: 'Ops Slack' })
  })

  it('shows the exact error returned by the test endpoint', async () => {
    mockFetch([channel({ id: 'c9', name: 'Lab ntfy', type: 'ntfy', url_masked: 'http://ntfy.lan/proxcenter' })], {
      post: () => json({ success: false, error: 'target ntfy.lan resolves to 10.42.0.12, a private address: refused unless the channel allows private networks' }),
    })
    renderCard()

    const row = await waitFor(() => rowOf('Lab ntfy'))

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await within(dialog).findByText('Test failed:')).toBeInTheDocument()
    expect(
      within(dialog).getByText('target ntfy.lan resolves to 10.42.0.12, a private address: refused unless the channel allows private networks'),
    ).toBeInTheDocument()

    const [{ url, body }] = requests('POST')

    expect(url).toBe(`${API}/test`)
    expect(body).toMatchObject({ id: 'c9', type: 'ntfy', url: '' })
  })

  it('deletes a channel after confirmation', async () => {
    mockFetch([channel()])
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Delete the channel "Ops Slack"? Notifications will no longer be sent to it.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(requests('DELETE')).toHaveLength(1))
    expect(requests('DELETE')[0].url).toBe(`${API}/c1`)
  })
})

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

async function openAdd() {
  const add = await screen.findByRole('button', { name: 'Add channel' })

  await waitFor(() => expect(add).toBeEnabled())
  fireEvent.click(add)

  return screen.findByRole('dialog')
}

async function openEdit(name: string) {
  const row = await waitFor(() => rowOf(name))

  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

  return screen.findByRole('dialog')
}

describe('NotificationChannelsCard states', () => {
  it('shows the load error and keeps the add button disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'orchestrator down' }, 500)))
    renderCard()

    expect(await screen.findByText(/Unable to load the channels: orchestrator down/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add channel' })).toBeDisabled()
    expect(screen.queryByText('No channel yet. Email stays the only recipient until one is added.')).not.toBeInTheDocument()
  })

  it('falls back to the HTTP status when the load error has no body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    renderCard()

    expect(await screen.findByText(/Unable to load the channels: HTTP 502/)).toBeInTheDocument()
  })

  it('describes each delivery state in the activity column', async () => {
    const longError = `HTTP 500: ${'x'.repeat(100)}`

    mockFetch([
      channel({ id: 'c1', name: 'Off', enabled: false }),
      channel({ id: 'c2', name: 'Sent', last_status: 'sent', last_sent_at: '2026-10-01T10:00:00Z' }),
      channel({ id: 'c3', name: 'Sent no date', last_status: 'sent', last_sent_at: null }),
      channel({ id: 'c4', name: 'Long error', last_status: 'failed', last_error: longError }),
      channel({ id: 'c5', name: 'Bare error', last_status: 'failed', last_error: '' }),
      channel({ id: 'c6', name: 'Defaults', types: undefined as any, min_severity: '' as any }),
    ])
    renderCard()

    const off = await waitFor(() => rowOf('Off'))

    expect(within(off).getAllByText('Disabled').length).toBeGreaterThan(0)
    expect(within(rowOf('Sent')).getByText(`Last sent ${new Date('2026-10-01T10:00:00Z').toLocaleString()}`)).toBeInTheDocument()
    expect(within(rowOf('Sent no date')).getByText(/^Last sent\s*$/)).toBeInTheDocument()
    expect(within(rowOf('Long error')).getByText(`Last error: ${longError.slice(0, 79)}…`)).toBeInTheDocument()
    expect(within(rowOf('Bare error')).getByText(/^Last error:\s*$/)).toBeInTheDocument()
    expect(within(rowOf('Defaults')).getByText('All types · Warnings and critical')).toBeInTheDocument()
  })
})

describe('NotificationChannelsCard saving', () => {
  it('confirms a save, closes the dialog and lets the message be dismissed', async () => {
    mockFetch([channel()])
    renderCard()

    const dialog = await openEdit('Ops Slack')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Channel saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByText('Channel saved')).not.toBeInTheDocument())
  })

  it('keeps the dialog open with the route error when a create is refused', async () => {
    mockFetch([], { post: () => json({ error: 'invalid slack URL' }, 400) })
    renderCard()

    const dialog = await openAdd()

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '  Ops  ' } })
    fireEvent.change(within(dialog).getByLabelText(/^URL/), { target: { value: ' https://example.com/hook ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Save failed: invalid slack URL')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(requests('POST')[0].body).toMatchObject({ name: 'Ops', url: 'https://example.com/hook' })
  })

  it('reports a failed toggle', async () => {
    mockFetch([channel()], { put: () => new Response('upstream exploded', { status: 500 }) })
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(row.querySelector('input[type="checkbox"]') as HTMLInputElement)

    expect(await screen.findByText('Save failed: upstream exploded')).toBeInTheDocument()
  })

  it('reports a failed deletion and keeps the confirmation open', async () => {
    mockFetch([channel()], { del: () => json({ error: 'channel is locked' }, 409) })
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Save failed: channel is locked')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancels a deletion without calling the route', async () => {
    mockFetch([channel()])
    renderCard()

    const row = await waitFor(() => rowOf('Ops Slack'))

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests('DELETE')).toHaveLength(0)
  })
})

describe('NotificationChannelsCard dialog', () => {
  it('does not test or save a channel without a name, and cancels', async () => {
    mockFetch([])
    renderCard()

    const dialog = await openAdd()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(requests('POST')).toHaveLength(0)
    expect(within(dialog).getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByLabelText(/^URL/)).toHaveAttribute('aria-invalid', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a delivered test, then dismisses it', async () => {
    mockFetch([channel()], { post: () => json({ success: true }) })
    renderCard()

    const dialog = await openEdit('Ops Slack')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await within(dialog).findByText('Test message delivered.')).toBeInTheDocument()
    expect(dialog.querySelector('pre')).toBeNull()

    fireEvent.click(within(dialog.querySelector('.MuiAlert-root') as HTMLElement).getByRole('button'))
    await waitFor(() => expect(within(dialog).queryByText('Test message delivered.')).not.toBeInTheDocument())
  })

  it('shows the route error when the test request itself fails', async () => {
    mockFetch([], { post: () => json({ error: 'orchestrator unavailable' }, 500) })
    renderCard()

    const dialog = await openAdd()

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ops' } })
    fireEvent.change(within(dialog).getByLabelText(/^URL/), { target: { value: 'https://hooks.slack.com/services/T/B/x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send test' }))

    expect(await within(dialog).findByText('orchestrator unavailable')).toBeInTheDocument()
    expect(requests('POST')[0].body).toMatchObject({ id: '', name: 'Ops', type: 'slack' })
  })

  it('asks an ntfy channel for a token and reveals the secrets on demand', async () => {
    mockFetch([])
    renderCard()

    const dialog = await openAdd()

    await pick('Type', 'ntfy')

    const url = within(dialog).getByLabelText(/^URL/) as HTMLInputElement
    const token = within(dialog).getByLabelText(/^Access token/) as HTMLInputElement

    expect(url.placeholder).toBe('https://ntfy.sh/proxcenter-alerts')
    expect(within(dialog).getByText('Full topic URL, on ntfy.sh or your own server.')).toBeInTheDocument()
    expect(within(dialog).getByText('Optional. Sent as a Bearer token to the ntfy server.')).toBeInTheDocument()
    expect(url.type).toBe('password')
    expect(token.type).toBe('password')

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Show secrets' })[0])

    expect(url.type).toBe('text')
    expect(token.type).toBe('text')

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Hide secrets' })[0])
    expect(url.type).toBe('password')

    fireEvent.change(token, { target: { value: 'tk_secret' } })
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Lab' } })
    fireEvent.change(url, { target: { value: 'https://ntfy.sh/lab' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('POST')).toHaveLength(1))
    expect(requests('POST')[0].body).toMatchObject({ type: 'ntfy', secret: 'tk_secret', url: 'https://ntfy.sh/lab' })
  })

  it('offers to drop the stored ntfy token', async () => {
    mockFetch([channel({ type: 'ntfy', name: 'Lab ntfy', has_secret: true })])
    renderCard()

    const dialog = await openEdit('Lab ntfy')

    expect(within(dialog).getByText('A value is stored. Leave blank to keep it.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('Remove the stored token'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('PUT')).toHaveLength(1))
    expect(requests('PUT')[0].body).toMatchObject({ clear_secret: true, secret: '' })
  })

  it('edits a webhook header and clears its stored secrets', async () => {
    mockFetch([
      channel({ id: 'w1', type: 'webhook', name: 'Relay', header_name: 'X-Api-Key', has_secret: true, has_header_value: true }),
    ])
    renderCard()

    const dialog = await openEdit('Relay')

    expect(within(dialog).getAllByText('A value is stored. Leave blank to keep it.')).toHaveLength(2)
    expect((within(dialog).getByLabelText(/^Custom header name/) as HTMLInputElement).value).toBe('X-Api-Key')

    fireEvent.change(within(dialog).getByLabelText(/^Custom header name/), { target: { value: 'Authorization' } })
    fireEvent.change(within(dialog).getByLabelText(/^Custom header value/), { target: { value: 'Bearer abc' } })
    fireEvent.change(within(dialog).getByLabelText(/^Signing secret/), { target: { value: 'hmac' } })
    fireEvent.click(within(dialog).getByLabelText('Remove the stored signing secret'))
    fireEvent.click(within(dialog).getByLabelText('Remove the stored header value'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('PUT')).toHaveLength(1))
    expect(requests('PUT')[0]).toMatchObject({
      url: `${API}/w1`,
      body: {
        type: 'webhook',
        header_name: 'Authorization',
        header_value: 'Bearer abc',
        secret: 'hmac',
        clear_secret: true,
        clear_header_value: true,
      },
    })
  })

  it('shows the signing secret helper on a new webhook', async () => {
    mockFetch([])
    renderCard()

    const dialog = await openAdd()

    await pick('Type', 'Webhook')

    // The angle brackets are escaped in the catalogue: unescaped, next-intl
    // reads them as a tag and the field shows the key path instead.
    expect(
      within(dialog).getByText('Optional. Each request then carries X-ProxCenter-Signature: sha256=<HMAC-SHA256 of the body>.'),
    ).toBeInTheDocument()
    expect((within(dialog).getByLabelText(/^URL/) as HTMLInputElement).placeholder).toBe('https://relay.example.com/proxcenter')
    expect(within(dialog).queryByLabelText('Remove the stored signing secret')).not.toBeInTheDocument()
  })

  it('sends the chosen filters, the private network opt-in and the enabled flag', async () => {
    mockFetch([channel({ types: [] })])
    renderCard()

    const dialog = await openEdit('Ops Slack')

    expect(combobox('Notification types')).toHaveTextContent('All types')

    fireEvent.mouseDown(combobox('Notification types'))
    fireEvent.click(await screen.findByRole('option', { name: 'Alerts' }))
    fireEvent.click(screen.getByRole('option', { name: 'Backups' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    expect(combobox('Notification types')).toHaveTextContent('Alerts, Backups')

    await pick('Minimum severity', 'Critical only')

    expect(within(dialog).getByText(/Loopback, link-local and private addresses/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('Allow private network targets'))
    expect(await within(dialog).findByText(/The orchestrator will post to addresses on its own networks/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Loopback, link-local and private addresses/)).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByLabelText('Enabled'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests('PUT')).toHaveLength(1))
    expect(requests('PUT')[0].body).toMatchObject({
      types: ['alert', 'backup'],
      min_severity: 'critical',
      allow_private_network: true,
      enabled: false,
    })
  })
})
