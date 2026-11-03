/**
 * The Micro-segmentation source of the Logging tab: the flows the zone engine saw towards zone guests, read from the
 * orchestrator's memory (GET /events through the relay), filtered by zone, verdict and search, paged by "Load older",
 * and refreshed every minute while it is on screen. The relay is a fetch stub; the shared test provider does not read
 * on mount, the page does. No automatic RTL cleanup in this repo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegEvent, MicrosegEventList, MicrosegZone } from '@/lib/microseg/types'

import MicrosegEventsView, { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH, serverQuery } from './MicrosegEventsView'

const ZONES = [
  { id: 'z1', name: 'web', color: '#22c55e' },
  { id: 'z2', name: 'db', color: '#3b82f6' },
] as MicrosegZone[]

const event = (over: Partial<MicrosegEvent> = {}): MicrosegEvent => ({
  seq: 11, ts: '2026-11-03T10:00:00Z', node: 'pve1', vmid: 101, type: 'qemu', guest: 'web-01', zone: 'web', src_zone: 'db',
  src_ip: '10.0.0.5', dst_ip: '10.0.1.7', proto: 'tcp', dport: 22, verdict: 'would_block', ...over,
})

const PAGE: MicrosegEventList = {
  events: [
    event(),
    event({ seq: 10, ts: '2026-11-03T09:59:00Z', vmid: 0, guest: '', zone: 'db', src_zone: '', src_ip: '192.168.9.9', dst_ip: '10.0.2.2', dport: 9999, verdict: 'blocked' }),
  ],
  truncated: false,
  oldest: '2026-11-03T09:59:00Z',
}

let answer: (url: string) => MicrosegEventList | { status: number; body: unknown }

function stubRelay() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const out = answer(String(url))
    const status = 'status' in out ? out.status : 200
    const body = 'status' in out ? out.body : out

    return { ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body }
  }))
}

const urls = () => vi.mocked(fetch).mock.calls.map(([u]) => new URL(String(u), 'http://x'))
const params = (u: URL) => Object.fromEntries(u.searchParams)

function renderView() {
  return renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
      <MicrosegEventsView connectionId='conn-1' zones={ZONES} guests={{ 101: { name: 'web-01', type: 'qemu', status: 'running' } }} />
    </SWRConfig>,
  )
}

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  answer = () => PAGE
  stubRelay()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MicrosegEventsView', () => {
  it('asks the relay for the 200 newest events and draws the table from them', async () => {
    renderView()

    await screen.findByText('web-01')
    const first = urls()[0]

    expect(first.pathname).toBe('/api/v1/firewall/microseg/conn-1/events')
    expect(params(first)).toEqual({ limit: '200' })

    const rows = screen.getAllByRole('row').slice(1)

    expect(rows).toHaveLength(2)

    const [wouldBlock, blocked] = rows.map(r => within(r))

    // Verdict chips, with the colours of the map: red would be blocked, blue blocked.
    expect(wouldBlock.getByText('Would be blocked').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError')
    expect(blocked.getByText('Blocked').closest('.MuiChip-root')).toHaveClass('MuiChip-colorInfo')

    // Source: the IP. Destination: the guest and its vmid when known, else the IP.
    expect(wouldBlock.getByText('10.0.0.5')).toBeInTheDocument()
    expect(wouldBlock.getByText('web-01')).toBeInTheDocument()
    expect(wouldBlock.getByText('#101')).toBeInTheDocument()
    expect(blocked.getByText('192.168.9.9')).toBeInTheDocument()
    expect(blocked.getByText('10.0.2.2')).toBeInTheDocument()

    // Service: its name with the raw protocol and port in the tooltip, the raw form when the port has no name.
    expect(wouldBlock.getByText('SSH')).toHaveAttribute('aria-label', 'SSH (tcp/22)')
    expect(blocked.getByText('tcp/9999')).toBeInTheDocument()

    // Zones: src_zone -> zone, a lone zone when the source is in none.
    expect(wouldBlock.getByText('db')).toBeInTheDocument()
    expect(wouldBlock.getByText('web')).toBeInTheDocument()
    expect(blocked.getAllByText(/^(db|web)$/)).toHaveLength(1)
  })

  it('tells the engine has seen nothing yet, in the table width', async () => {
    answer = () => ({ events: [], truncated: false, oldest: null })
    renderView()

    const text = await screen.findByText('No event yet: the engine reads the node logs every minute.')
    const cell = text.closest('td') as HTMLElement

    expect(cell).toHaveAttribute('colspan', '6')
    expect(getComputedStyle(cell).whiteSpace).toBe('normal')
    expect(getComputedStyle(text).whiteSpace).toBe('normal')
    expect(getComputedStyle(text).maxWidth).toBe('520px')
  })

  it('sends the zone and verdict filters as query parameters', async () => {
    renderView()
    await screen.findByText('web-01')

    await pick('Zone', 'web')
    await waitFor(() => expect(urls().some(u => u.searchParams.get('zone') === 'web')).toBe(true))

    await pick('Verdict', 'Would be blocked')
    await waitFor(() => expect(params(urls().at(-1)!)).toEqual({ limit: '200', zone: 'web', verdict: 'would_block' }))

    // Back to all verdicts: the key is the one already read (within the deduping window), so it is served from the cache.
    await pick('Verdict', 'All verdicts')
    expect(screen.getByRole('combobox', { name: 'Verdict' })).toHaveTextContent('All verdicts')
  })

  it('filters the lines at once and sends the search as q once typing stops', async () => {
    renderView()
    await screen.findByText('web-01')

    const box = screen.getByPlaceholderText('Search an IP, a port, a guest, a zone…')

    fireEvent.change(box, { target: { value: '192.168' } })

    // Client side, before any request: the other line is gone.
    expect(screen.queryByText('web-01')).toBeNull()
    expect(screen.getByText('192.168.9.9')).toBeInTheDocument()

    await waitFor(() => expect(urls().some(u => u.searchParams.get('q') === '192.168')).toBe(true), { timeout: SEARCH_DEBOUNCE_MS * 4 })
    expect(urls().filter(u => u.searchParams.has('q'))).toHaveLength(1)

    // A guest, a zone, a port and a service name are found too.
    for (const [text, line] of [['web-01', '10.0.0.5'], ['db', '10.0.0.5'], ['9999', '192.168.9.9'], ['ssh', '10.0.0.5']] as const) {
      fireEvent.change(box, { target: { value: text } })
      expect(screen.getAllByText(line).length, text).toBeGreaterThan(0)
    }

    fireEvent.change(box, { target: { value: 'nothing-like-this' } })
    expect(screen.getByText('No entry matches the filters.')).toBeInTheDocument()
  })

  it('sends a guest, zone or service name to no server filter: it is matched on the lines read', async () => {
    renderView()
    await screen.findByText('web-01')
    const box = screen.getByPlaceholderText('Search an IP, a port, a guest, a zone…')

    fireEvent.change(box, { target: { value: 'web-01' } })
    expect(screen.getAllByText('10.0.0.5').length).toBeGreaterThan(0)
    await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS * 2))

    expect(urls().some(u => u.searchParams.has('q'))).toBe(false)
    expect(box.getAttribute('maxlength')).toBe(String(SEARCH_MAX_LENGTH))
  })

  it('pages the older events by the seq of the last one, and keeps the newest on screen', async () => {
    const newest = Array.from({ length: 200 }, (_, i) => event({ seq: 1000 - i, ts: new Date(Date.UTC(2026, 10, 3, 10, 0, 0) - i * 1000).toISOString(), src_ip: `10.1.${Math.floor(i / 250)}.${i % 250}` }))
    const older = [event({ seq: 800, ts: '2026-11-03T08:00:00.000Z', src_ip: '172.16.0.1' })]

    answer = url => (new URL(url, 'http://x').searchParams.has('before_seq')
      ? { events: older, truncated: false, oldest: older[0].ts }
      : { events: newest, truncated: true, oldest: newest[199].ts })
    renderView()

    await screen.findByText('10.1.0.0')
    expect(screen.getByText(/Showing the 200 most recent/)).toBeInTheDocument()
    expect(screen.getByText(/zone and guest names as they were when the event was seen/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))

    await waitFor(() => expect(urls().some(u => u.searchParams.has('before_seq'))).toBe(true))
    expect(params(urls().at(-1)!)).toEqual({ limit: '200', before_seq: '801' })
    await waitFor(() => expect(screen.getByText(/Showing the 201 most recent/)).toBeInTheDocument())

    // The last page was short and not truncated: nothing older to ask for. The first page is still there.
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull()
    expect(screen.queryByText(/older lines were dropped/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search an IP, a port, a guest, a zone…'), { target: { value: '172.16' } })
    expect(screen.getByText('172.16.0.1')).toBeInTheDocument()
  })

  it('says older lines were dropped when the ring is truncated, and only then', async () => {
    answer = () => ({ ...PAGE, truncated: true })
    renderView()

    expect(await screen.findByText(/Showing the 2 most recent · from the orchestrator's memory, read every minute from the nodes, no extra Proxmox call · zone and guest names as they were when the event was seen · older lines were dropped/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load older' })).toBeInTheDocument()

    cleanup()
    answer = () => PAGE
    renderView()

    const caption = await screen.findByText(/Showing the 2 most recent/)

    expect(caption.textContent).not.toContain('older lines were dropped')
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull()
  })

  it('shows a refused read as a message, and reads again on request', async () => {
    answer = () => ({ status: 503, body: { code: 'NOT_LEADER', error: 'not the leader' } })
    renderView()

    expect(await screen.findByText('This orchestrator node is not the leader. Try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByText('No event yet: the engine reads the node logs every minute.')).toBeNull()

    answer = () => PAGE
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('web-01')).toBeInTheDocument()
  })

  it('reads again every minute, and on the refresh button', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    renderView()

    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(urls()).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
    expect(urls()).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(urls()).toHaveLength(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(urls()).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(urls()).toHaveLength(4)
  })

  it('stops reading when it leaves the screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const view = renderView()

    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(urls()).toHaveLength(1)
  })
})

describe('serverQuery', () => {
  it('keeps an IPv4, an IPv6 or a port, and nothing else', () => {
    expect(serverQuery(' 192.168.1 ')).toBe('192.168.1')
    expect(serverQuery('443')).toBe('443')
    expect(serverQuery('fe80::1')).toBe('fe80::1')
    expect(serverQuery('2001:db8:')).toBe('2001:db8:')
    expect(serverQuery('web-01')).toBe('')
    expect(serverQuery('ssh')).toBe('')
    expect(serverQuery('dead')).toBe('')
  })
})
