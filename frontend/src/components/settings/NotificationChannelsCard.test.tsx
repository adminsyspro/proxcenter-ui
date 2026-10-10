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
