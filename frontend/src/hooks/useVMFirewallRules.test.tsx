/**
 * The guest list of the Firewalling > VMs and Security Groups tabs (UA44): ONE request to the coverage route, which
 * the server bounds (one Proxmox call per guest at most, cached), and a guest's rules read only when asked for that
 * guest. The hook used to ask rules, options and config for every guest on mount. No automatic RTL cleanup here.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/firewall', () => ({
  getVMRules: vi.fn(),
  getVMOptions: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import { useVMFirewallRules } from './useVMFirewallRules'

const row = (vmid: number, over: Record<string, unknown> = {}) => ({
  type: 'qemu', node: 'pve1', vmid: String(vmid), name: `vm-${vmid}`, status: 'running', tags: ['zone-web'],
  enabled: true, optionsEnabled: true, nicFirewall: true, options: { enable: 1, policy_in: 'DROP' }, vlans: [20],
  ...over,
})

const coverage = (guests: unknown[], over: Record<string, unknown> = {}) => ({
  total: guests.length, measured: guests.length, enabled: 0, disabled: 0, unknown: 0, sampled: false, partial: false,
  computedAt: '2026-11-03T10:00:00.000Z', computing: false, guests, ...over,
})

const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.mocked(firewallAPI.getVMRules).mockReset()
  vi.mocked(firewallAPI.getVMOptions).mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const urls = () => fetchMock.mock.calls.map(([u]) => String(u))

describe('useVMFirewallRules (UA44)', () => {
  it('reads the guest list in one request to the coverage route, and no guest rules, options or config', async () => {
    fetchMock.mockResolvedValue(answer(coverage([row(100), row(101, { enabled: null, nicFirewall: null })], { total: 250, measured: 200 })))
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => { await result.current.loadVMFirewallData() })

    expect(urls()).toEqual(['/api/v1/firewall/coverage/conn-1'])
    expect(firewallAPI.getVMRules).not.toHaveBeenCalled()
    expect(firewallAPI.getVMOptions).not.toHaveBeenCalled()
    expect(result.current.vmFirewallData).toHaveLength(2)
    expect(result.current.vmFirewallData[0]).toMatchObject({
      vmid: 100, name: 'vm-100', firewallEnabled: true, optionsEnabled: true, nicFirewallEnabled: true,
      stateUnknown: false, rules: [], rulesLoaded: false, vlans: [20], tags: ['zone-web'], options: { policy_in: 'DROP' },
    })
    expect(result.current.vmFirewallData[1]).toMatchObject({ stateUnknown: true, firewallEnabled: false })
    expect(result.current.guestsNotScanned).toBe(50)
    expect(result.current.loadingVMRules).toBe(false)
  })

  it('reads again while the server is still computing, then shows its figures', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(answer({ computing: true }))
      .mockResolvedValueOnce(answer(coverage([row(100)])))
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    let done: Promise<void> = Promise.resolve()
    act(() => { done = result.current.loadVMFirewallData() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await done })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.vmFirewallData).toHaveLength(1)
  })

  it('reads one guest rules once, when asked for that guest', async () => {
    fetchMock.mockResolvedValue(answer(coverage([row(100), row(101)])))
    vi.mocked(firewallAPI.getVMRules).mockResolvedValue([{ pos: 0, type: 'group', action: 'sg-web' }] as any)
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))
    await act(async () => { await result.current.loadVMFirewallData() })

    await act(async () => {
      await Promise.all([
        result.current.loadGuestRules(result.current.vmFirewallData[0]),
        result.current.loadGuestRules(result.current.vmFirewallData[0]),
      ])
    })

    expect(firewallAPI.getVMRules).toHaveBeenCalledTimes(1)
    expect(firewallAPI.getVMRules).toHaveBeenCalledWith('conn-1', 'pve1', 'qemu', 100)
    expect(result.current.vmFirewallData[0]).toMatchObject({ rulesLoaded: true, rules: [{ action: 'sg-web' }] })
    expect(result.current.vmFirewallData[1].rulesLoaded).toBe(false)
  })

  it('asks the server for new figures on a forced load, and keeps the rules already read', async () => {
    fetchMock.mockResolvedValue(answer(coverage([row(100)])))
    vi.mocked(firewallAPI.getVMRules).mockResolvedValue([{ pos: 0, type: 'in', action: 'ACCEPT' }] as any)
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))
    await act(async () => { await result.current.loadVMFirewallData() })
    await act(async () => { await result.current.loadGuestRules(result.current.vmFirewallData[0]) })

    await act(async () => { await result.current.loadVMFirewallData() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.loadVMFirewallData(true) })

    expect(urls()[1]).toBe('/api/v1/firewall/coverage/conn-1?refresh=1')
    expect(result.current.vmFirewallData[0]).toMatchObject({ rulesLoaded: true, rules: [{ action: 'ACCEPT' }] })
  })

  it('reports a failed load instead of an empty list that reads as no guest', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'HTTP 502' }, 502))
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => { await result.current.loadVMFirewallData() })

    expect(result.current.vmRulesError).toBe('HTTP 502')
    expect(result.current.vmFirewallData).toEqual([])
  })

  it('reloads one guest after an edit, with its rules, options and NIC config', async () => {
    fetchMock.mockResolvedValueOnce(answer(coverage([row(100, { enabled: false, optionsEnabled: false })])))
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))
    await act(async () => { await result.current.loadVMFirewallData() })

    vi.mocked(firewallAPI.getVMRules).mockResolvedValue([])
    vi.mocked(firewallAPI.getVMOptions).mockResolvedValue({ enable: 1 })
    fetchMock.mockResolvedValueOnce({ json: async () => ({ data: { net0: 'virtio=AA,bridge=vmbr0,tag=30,firewall=1' } }) })

    await act(async () => { await result.current.reloadVMFirewallRules(result.current.vmFirewallData[0]) })

    expect(result.current.vmFirewallData[0]).toMatchObject({ firewallEnabled: true, rulesLoaded: true, vlans: [30] })
  })

  it('drops the late answer of the connection that was left', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const { result, rerender } = renderHook(({ id }: { id: string }) => useVMFirewallRules(id), { initialProps: { id: 'conn-1' } })
    let first: Promise<void> = Promise.resolve()
    act(() => { first = result.current.loadVMFirewallData() })

    rerender({ id: 'conn-2' })
    fetchMock.mockResolvedValueOnce(answer(coverage([row(200)])))
    await act(async () => { await result.current.loadVMFirewallData() })
    release(answer(coverage([row(100)])))
    await act(async () => { await first })

    await waitFor(() => expect(result.current.vmFirewallData.map(v => v.vmid)).toEqual([200]))
  })
})
