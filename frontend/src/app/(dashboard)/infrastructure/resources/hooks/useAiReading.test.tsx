import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { SWRConfig } from 'swr'

import { useAiReading } from './useAiReading'

type Reading = { summary: string }

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response
}

function wrapperFor(locale: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
      </NextIntlClientProvider>
    )
  }
}

function renderReading(connectionId: string | undefined, enabled = true, locale = 'en') {
  return renderHook(() => useAiReading<Reading>('/api/v1/resources/forecast-insights', connectionId, enabled), { wrapper: wrapperFor(locale) })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useAiReading', () => {
  it('fetches nothing while disabled', () => {
    const { result } = renderReading('c1', false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.reading).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('reads the scope of a connection, keyed by locale, and returns the payload data', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { summary: 'cached reading' } }))

    const { result } = renderReading('c1')

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.reading).toEqual({ summary: 'cached reading' }))
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/resources/forecast-insights?connectionId=c1#en', { cache: 'no-store' })
  })

  it('reads the whole estate without a connection, in the current locale', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { summary: 'estate' } }))

    const { result } = renderReading(undefined, true, 'fr')

    await waitFor(() => expect(result.current.reading).toEqual({ summary: 'estate' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/resources/forecast-insights#fr', { cache: 'no-store' })
  })

  it('reports a failed read', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))

    const { result } = renderReading('c1')

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.reading).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('regenerate forces a refresh of the scope and replaces the reading without refetching', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { summary: 'old' } }))
    const { result } = renderReading('c1')
    await waitFor(() => expect(result.current.reading).toEqual({ summary: 'old' }))

    let release: (res: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve }))

    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = result.current.regenerate() })

    expect(result.current.loading).toBe(true)
    expect(result.current.reading).toEqual({ summary: 'old' })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resources/forecast-insights?connectionId=c1&refresh=1', { cache: 'no-store' })

    await act(async () => {
      release(jsonResponse({ data: { summary: 'fresh' } }))
      await pending
    })

    expect(result.current.reading).toEqual({ summary: 'fresh' })
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('regenerate without a connection starts the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { summary: 'x' } }))
    const { result } = renderReading(undefined)
    await waitFor(() => expect(result.current.reading).not.toBeNull())

    await act(async () => { await result.current.regenerate() })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resources/forecast-insights?refresh=1', { cache: 'no-store' })
  })

  it('reports a failed regenerate and keeps the previous reading', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { summary: 'old' } }))
    const { result } = renderReading('c1')
    await waitFor(() => expect(result.current.reading).toEqual({ summary: 'old' }))

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 502))
    await act(async () => { await result.current.regenerate() })

    expect(result.current.failed).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.reading).toEqual({ summary: 'old' })
  })

  it('clears a regenerate failure on the next successful attempt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { summary: 'old' } }))
    const { result } = renderReading('c1')
    await waitFor(() => expect(result.current.reading).not.toBeNull())

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await act(async () => { await result.current.regenerate() })
    expect(result.current.failed).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { summary: 'back' } }))
    await act(async () => { await result.current.regenerate() })

    expect(result.current.failed).toBe(false)
    expect(result.current.reading).toEqual({ summary: 'back' })
  })
})
