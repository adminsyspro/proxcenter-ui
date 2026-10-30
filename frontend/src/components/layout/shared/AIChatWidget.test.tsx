import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react'

import { encodeFrame } from '@/lib/ai/streamFrames'

const h = vi.hoisted(() => ({
  // Stable across renders, like the real hook: `t` is a dependency of sendMessage.
  t: (key: string) => key
}))

vi.mock('next-intl', () => ({ useTranslations: () => h.t, useLocale: () => 'en' }))

// The real logo pulls the navigation and branding contexts.
vi.mock('./Logo', () => ({ LogoIcon: () => <svg data-testid='logo' /> }))

import AIChatWidget, { toolSources } from './AIChatWidget'

type FetchInit = { body?: string; signal?: AbortSignal }

const SETTINGS = { data: { enabled: true, provider: 'ollama', model: 'qwen3.5:9b' } }

const ANSWER = '## Hosts\n\n| Host | RAM |\n|---|---:|\n| pve2 | 80.6% |\n'

const streamOf = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      }
    })
  )

// A stream that only ends when the request is aborted, the way a model still
// generating behaves.
const endlessStream = (signal: AbortSignal | undefined, first: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first))
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
      }
    })
  )

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: FetchInit) => Promise<Response>>>
let streamReply: (init?: FetchInit) => Response

beforeEach(() => {
  streamReply = () =>
    streamOf([
      encodeFrame({ type: 'tool', names: ['list_hosts'] }),
      ANSWER,
      encodeFrame({ type: 'trace', calls: [{ name: 'list_hosts', ok: true }, { name: 'get_ceph_status', ok: false }] })
    ])
  fetchMock = vi.fn(async (url: string, init?: FetchInit) => {
    if (url === '/api/v1/ai/status') return new Response(JSON.stringify(SETTINGS))
    if (url === '/api/v1/ai/chat/stream') return streamReply(init)

    return new Response(JSON.stringify({ response: 'fallback' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  // jsdom has no layout: the chart frame renders, its bars need a size.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Element.prototype.scrollTo = () => {}
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openWidget = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'ai.title' }))
  await screen.findByText('ai.readOnly')
}

describe('AIChatWidget', () => {
  it('shows nothing when the assistant is not available', () => {
    const { container } = render(<AIChatWidget available={false} />)

    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: 'ai.title' })).toBeNull()
  })

  it('opens from the round launcher with the read-only notice and the model', async () => {
    render(<AIChatWidget available />)

    expect(screen.queryByRole('dialog')).toBeNull()
    await openWidget()

    expect(screen.getByRole('dialog', { name: 'ai.title' })).toBeTruthy()
    expect(await screen.findByText('qwen3.5:9b')).toBeTruthy()
    expect(screen.getByText('ai.readOnlyBadge')).toBeTruthy()
  })

  it('renders the answer as Markdown with its sources and a copy button', async () => {
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.click(screen.getByText('ai.suggestInfraStatus'))

    const cell = await screen.findByText('80.6%')

    expect(cell.closest('table')).toBeTruthy()
    expect(screen.getByText('ai.sources')).toBeTruthy()
    expect(screen.getByText('ai.tools.listHosts')).toBeTruthy()
    expect(screen.getByText('ai.tools.getCephStatus (ai.toolFailed)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ai.copy' })).toBeTruthy()

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/ai/chat/stream')!

    expect(JSON.parse(init!.body!)).toEqual({
      messages: [{ role: 'user', content: 'ai.suggestInfraStatus' }],
      locale: 'en',
      // So a history answer gives times in the reader's zone.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  })

  it('draws the charts of the answer under it, in the reader\'s language', async () => {
    streamReply = () =>
      streamOf([
        ANSWER,
        encodeFrame({ type: 'trace', calls: [{ name: 'rank_storage', ok: true }] }),
        encodeFrame({
          type: 'charts',
          charts: [
            {
              kind: 'storage-usage',
              unit: '%',
              series: ['used'],
              rows: [
                { label: 'ZFS-Pool (pve1)', values: [93.1] },
                { label: 'CephStoragePool', values: [86.8] }
              ]
            }
          ]
        })
      ])
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.click(screen.getByText('ai.suggestInfraStatus'))

    expect(await screen.findByRole('figure', { name: 'ai.charts.storageUsage' })).toBeTruthy()
  })

  it('draws a history curve titled with its target and period', async () => {
    streamReply = () =>
      streamOf([
        'CPU stayed low.',
        encodeFrame({
          type: 'charts',
          charts: [
            {
              kind: 'history',
              metric: 'cpu',
              unit: '%',
              series: ['cpu'],
              target: 'pve1',
              timeframe: 'day',
              rows: [
                { label: '', time: 1_790_000_000, values: [2] },
                { label: '', time: 1_790_000_600, values: [3] }
              ]
            }
          ]
        })
      ])
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.click(screen.getByText('ai.suggestTopCpu'))

    expect(await screen.findByRole('figure', { name: 'ai.charts.history.cpu · ai.charts.timeframes.day' })).toBeTruthy()
  })

  it('keeps the charts the plain route returns', async () => {
    streamReply = () => new Response('{}', { status: 500 })
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      if (url === '/api/v1/ai/status') return new Response(JSON.stringify(SETTINGS))
      if (url === '/api/v1/ai/chat/stream') return streamReply(init)

      return new Response(
        JSON.stringify({
          response: 'fallback',
          toolCalls: [{ name: 'rank_guest_hardware', ok: true }],
          charts: [
            {
              kind: 'guest-ranking',
              metric: 'vcpus',
              unit: 'vCPU',
              series: ['vcpus'],
              rows: [
                { label: 'db-01', values: [16] },
                { label: 'web-01', values: [8] }
              ]
            },
            { kind: 'pie' }
          ]
        })
      )
    })
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.click(screen.getByText('ai.suggestTopCpu'))

    expect(await screen.findByRole('figure', { name: 'ai.charts.guest.vcpus' })).toBeTruthy()
    expect(screen.getAllByRole('figure')).toHaveLength(1)
  })

  it('stops a running answer, keeps what arrived and never retries', async () => {
    streamReply = init => endlessStream(init?.signal, 'Partial answer')
    render(<AIChatWidget available />)
    await openWidget()

    const input = screen.getByPlaceholderText('ai.askQuestion')

    fireEvent.change(input, { target: { value: 'Are there any alerts?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('Partial answer')
    fireEvent.click(screen.getByRole('button', { name: 'ai.stop' }))

    expect(await screen.findByText('ai.stopped')).toBeTruthy()
    expect(screen.getByText('Partial answer')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/ai/chat')).toBe(false)
  })

  it('does not send on Enter while an input method is composing, nor on Shift+Enter', async () => {
    render(<AIChatWidget available />)
    await openWidget()

    const input = screen.getByPlaceholderText('ai.askQuestion')

    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/ai/chat/stream')).toBe(false)
  })

  it('falls back to the plain route when the stream fails', async () => {
    streamReply = () => new Response('{}', { status: 500 })
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.click(screen.getByText('ai.suggestAlerts'))

    expect(await screen.findByText('fallback')).toBeTruthy()
  })

  it('closes on Escape and from the launcher', async () => {
    render(<AIChatWidget available />)
    await openWidget()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await openWidget()
    fireEvent.click(screen.getByRole('button', { name: 'common.close', expanded: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('toolSources', () => {
  it('lists each tool once, failed when any of its calls failed', () => {
    expect(
      toolSources([
        { name: 'list_hosts', ok: true },
        { name: 'get_ceph_status', ok: false },
        { name: 'list_hosts', ok: false },
        { name: 'get_ceph_status', ok: true }
      ])
    ).toEqual([
      { name: 'list_hosts', failed: true },
      { name: 'get_ceph_status', failed: true }
    ])
  })

  it('accepts the bare names of a round that is starting', () => {
    expect(toolSources(['rank_storage', 'rank_storage'])).toEqual([{ name: 'rank_storage', failed: false }])
  })
})
