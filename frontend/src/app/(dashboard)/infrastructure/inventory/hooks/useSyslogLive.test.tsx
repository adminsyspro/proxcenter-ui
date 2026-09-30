import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useSyslogLive, useCephLogLive } from './useSyslogLive'

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: ['Sep 30 10:00:01 pve1 systemd[1]: Started pvedaemon.service.'] }),
  } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSyslogLive', () => {
  it('fetches the node syslog immediately when live mode is on for the syslog sub-tab', async () => {
    const setData = vi.fn()

    renderHook(() => useSyslogLive(true, 'node', 'conn1:pve1', 6, 6, setData))

    await waitFor(() => expect(setData).toHaveBeenCalledWith(['Sep 30 10:00:01 pve1 systemd[1]: Started pvedaemon.service.']))

    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toMatch(/^\/api\/v1\/connections\/conn1\/nodes\/pve1\/syslog\?limit=200&_t=\d+$/)
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('does not poll when live mode is off', () => {
    renderHook(() => useSyslogLive(false, 'node', 'conn1:pve1', 6, 6, vi.fn()))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refetches immediately when the browser tab becomes visible again', async () => {
    const setData = vi.fn()

    renderHook(() => useSyslogLive(true, 'node', 'conn1:pve1', 6, 6, setData))
    await waitFor(() => expect(setData).toHaveBeenCalledTimes(1))

    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))

    await waitFor(() => expect(setData).toHaveBeenCalledTimes(2))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('useCephLogLive', () => {
  it('merges the Ceph log into the node Ceph data', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { log: ['mon.pve1 cluster [INF] overall HEALTH_OK'] } }) } as any)
    const setCeph = vi.fn()

    renderHook(() => useCephLogLive(true, 'node', 'conn1:pve1', 'prod', setCeph))

    await waitFor(() => expect(setCeph).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v1/connections/conn1/nodes/pve1/ceph?section=log&logLines=100')
    const updater = setCeph.mock.calls[0][0]
    expect(updater({ status: 'ok' })).toEqual({ status: 'ok', log: ['mon.pve1 cluster [INF] overall HEALTH_OK'] })
  })
})
