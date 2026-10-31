import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen, within } from '@testing-library/react'

import type { ActionCard } from '@/lib/ai/actions/types'
import { encodeFrame } from '@/lib/ai/streamFrames'

const h = vi.hoisted(() => ({
  // Stable across renders, like the real hook: `t` is a dependency of sendMessage.
  t: (key: string) => key
}))

vi.mock('next-intl', () => ({ useTranslations: () => h.t, useLocale: () => 'en' }))

// The real logo pulls the navigation and branding contexts.
vi.mock('./Logo', () => ({ LogoIcon: () => <svg data-testid='logo' /> }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: unknown; href: string }) => <a href={href}>{children as never}</a>
}))

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
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Binds the action cards of this thread (roadmap#188).
      conversationId: expect.stringMatching(/^[A-Za-z0-9_-]{1,100}$/)
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

const START_CARD: ActionCard = {
  actionId: 'act-1',
  kind: 'start',
  tier: 'safe',
  target: { connId: 'c1', cluster: 'prod', node: 'pve1', vmid: 104, guestKind: 'qemu', name: 'win2025' },
  params: {},
  preflight: { ok: true, checks: [{ level: 'ok', text: 'Guest is stopped' }] },
  expiresAt: Date.now() + 600_000,
  token: 'signed'
}

const bodyOf = (url: string, nth = 0) => {
  const calls = fetchMock.mock.calls.filter(([u]) => u === url)

  return JSON.parse(calls[nth][1]!.body!)
}

describe('AIChatWidget actions (roadmap#188)', () => {
  const ask = async (text: string) => {
    const input = screen.getByPlaceholderText('ai.askQuestion')

    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('renders the cards of the actions frame under the answer and runs one with the thread id', async () => {
    streamReply = () =>
      streamOf(['Here is the card.', encodeFrame({ type: 'actions', cards: [START_CARD], plans: [] })])
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      if (url === '/api/v1/ai/status') return new Response(JSON.stringify(SETTINGS))
      if (url === '/api/v1/ai/chat/stream') return streamReply(init)
      if (url === '/api/v1/ai/actions/execute') return new Response(JSON.stringify({ ok: true, result: { node: 'pve1', connId: 'c1', message: 'Done' } }))

      return new Response(JSON.stringify({ response: 'fallback' }))
    })
    render(<AIChatWidget available />)
    await openWidget()
    await ask('start win2025')

    const card = await screen.findByRole('group', { name: 'ai.actions.title.start' })

    fireEvent.click(within(card).getByRole('button', { name: 'ai.actions.execute' }))
    expect(await within(card).findByText('ai.actions.done')).toBeTruthy()

    const executed = bodyOf('/api/v1/ai/actions/execute')

    expect(executed.card.token).toBe('signed')
    expect(executed.conversationId).toBe(bodyOf('/api/v1/ai/chat/stream').conversationId)
    expect(executed.confirmed).toBeUndefined()

    // The next turn tells the model what was run, on the answer that proposed
    // it, and never sends the cards themselves.
    streamReply = () => streamOf(['ok'])
    await ask('and now?')
    await screen.findByText('ok')

    const next = bodyOf('/api/v1/ai/chat/stream', 1)

    expect(next.messages).toEqual([
      { role: 'user', content: 'start win2025' },
      { role: 'assistant', content: 'Here is the card.\n\nAction start win2025 (104) on pve1: done' },
      { role: 'user', content: 'and now?' }
    ])
    expect(next.conversationId).toBe(executed.conversationId)
  })

  it('starts a new thread id when the conversation is cleared', async () => {
    render(<AIChatWidget available />)
    await openWidget()
    await ask('first')
    await screen.findByText('80.6%')

    fireEvent.click(screen.getByRole('button', { name: 'ai.clearConversation' }))
    await ask('second')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/v1/ai/chat/stream')).toHaveLength(2))

    expect(bodyOf('/api/v1/ai/chat/stream', 1).conversationId).not.toBe(bodyOf('/api/v1/ai/chat/stream', 0).conversationId)
  })

  it('sanitises the actions of the plain route like the stream decoder does', async () => {
    streamReply = () => new Response('{}', { status: 500 })
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      if (url === '/api/v1/ai/status') return new Response(JSON.stringify(SETTINGS))
      if (url === '/api/v1/ai/chat/stream') return streamReply(init)

      return new Response(
        JSON.stringify({
          response: 'fallback',
          actions: {
            cards: [START_CARD, { ...START_CARD, actionId: 'bad', kind: 'destroy' }, 'junk'],
            plans: [
              {
                planId: 'p1',
                finding: 'pending_updates',
                title: 'Install the pending updates of pve1',
                steps: [{ step: 1, manual: { text: 'Do it by hand.', href: 'javascript:alert(1)' } }]
              }
            ]
          }
        })
      )
    })
    render(<AIChatWidget available />)
    await openWidget()
    await ask('start win2025')

    expect(await screen.findByRole('group', { name: 'ai.actions.title.start' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'ai.actions.execute' })).toHaveLength(1)
    expect(screen.getByText('Do it by hand.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'ai.actions.openPage' })).toBeNull()

    expect(bodyOf('/api/v1/ai/chat').conversationId).toBe(bodyOf('/api/v1/ai/chat/stream').conversationId)
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
