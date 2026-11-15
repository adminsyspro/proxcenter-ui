/**
 * The Zero Trust fetchers read the cluster policy and each guest's firewall
 * state. Both used to disagree with what PVE enforces (#1065): an unset
 * policy_in passed for ACCEPT, and a guest counted as protected on its NIC
 * flag alone. The guest coverage is now the server's (UA44): the hook reads one
 * route and never asks a guest config, rules or options itself. No automatic RTL cleanup is configured in this repo.
 */
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('./useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))

import { useFirewallScores, useVMFirewallCoverage } from './useZeroTrust'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

const CONN = { id: 'conn-1', name: 'PVE-PROD', type: 'pve' }

describe('useFirewallScores', () => {
  it('scores an unset cluster policy as the DROP / ACCEPT that PVE applies', async () => {
    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json({ data: [CONN] })),
      http.get('*/api/v1/firewall/cluster/conn-1', () => HttpResponse.json({ enable: 1 })),
    )

    const { result } = renderHook(() => useFirewallScores(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data![0]).toMatchObject({ enabled: true, policyIn: 'DROP', policyOut: 'ACCEPT', score: 70 })
  })
})

describe('useVMFirewallCoverage', () => {
  const COVERAGE = { total: 36, measured: 36, enabled: 20, disabled: 15, unknown: 1, sampled: false, partial: true, computedAt: '2026-11-03T10:00:00.000Z', computing: false }

  it('reads the server figures of the connection once, and never a guest config, rules or options', async () => {
    const seen: string[] = []
    server.use(
      http.get('*/api/v1/firewall/coverage/:conn', ({ request, params }) => {
        seen.push(`${params.conn}${new URL(request.url).search}`)
        return HttpResponse.json(COVERAGE)
      }),
    )
    const perGuest = vi.fn()
    server.use(
      http.get('*/api/v1/connections/:conn/guests/:type/:node/:vmid/config', () => { perGuest(); return HttpResponse.json({}) }),
      http.get('*/api/v1/firewall/vms/:conn/:node/:type/:vmid', () => { perGuest(); return HttpResponse.json({}) }),
    )

    const { result } = renderHook(() => useVMFirewallCoverage('conn-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toMatchObject({ total: 36, enabled: 20 })
    expect(seen).toEqual(['conn-1'])
    expect(perGuest).not.toHaveBeenCalled()
  })

  it('asks nothing without a connection', async () => {
    const hit = vi.fn()
    server.use(http.get('*/api/v1/firewall/coverage/:conn', () => { hit(); return HttpResponse.json(COVERAGE) }))

    const { result } = renderHook(() => useVMFirewallCoverage(null), { wrapper })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(hit).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('asks for new figures on refresh()', async () => {
    const seen: string[] = []
    server.use(
      http.get('*/api/v1/firewall/coverage/:conn', ({ request }) => {
        const forced = new URL(request.url).searchParams.get('refresh') === '1'
        seen.push(forced ? 'forced' : 'plain')
        return HttpResponse.json({ ...COVERAGE, enabled: forced ? 21 : 20 })
      }),
    )

    const { result } = renderHook(() => useVMFirewallCoverage('conn-1'), { wrapper })
    await waitFor(() => expect(result.current.data?.enabled).toBe(20))

    await act(async () => { await result.current.refresh() })

    expect(result.current.data?.enabled).toBe(21)
    expect(result.current.refreshing).toBe(false)
    expect(seen).toEqual(['plain', 'forced'])
  })

  it('aborts the read in flight when the component goes away', async () => {
    let signal: AbortSignal | undefined
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }))

    const { unmount } = renderHook(() => useVMFirewallCoverage('conn-1'), { wrapper })
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(signal!.aborted).toBe(true)
    vi.stubGlobal('fetch', realFetch)
  })

  it('aborts both the first read and a refresh still in flight when the component goes away', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return new Promise<Response>(() => {})
    }))

    const { result, unmount } = renderHook(() => useVMFirewallCoverage('conn-1'), { wrapper })
    await waitFor(() => expect(signals).toHaveLength(1))
    act(() => { void result.current.refresh() })
    await waitFor(() => expect(signals).toHaveLength(2))
    unmount()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(signals.every(s => s.aborted)).toBe(true)
  })

  it('surfaces a server error', async () => {
    server.use(http.get('*/api/v1/firewall/coverage/:conn', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))

    const { result } = renderHook(() => useVMFirewallCoverage('conn-1'), { wrapper })

    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(result.current.error?.message).toBe('boom')
  })
})
