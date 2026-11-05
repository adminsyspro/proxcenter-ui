/**
 * The parts shared by the Observation sub-tab and the edge panel of the map: the kind glyph (one colour map, the
 * map's), the three resolve buttons and the resolve hook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { MicrosegApiError, MicrosegConflictError } from '@/lib/microseg/api'
import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { ObservedKindGlyph, ResolveActions, useResolveSuggestions, type ResolveOutcome } from './observationParts'

const resolveMock = vi.fn<(body: unknown) => Promise<unknown>>()

vi.mock('@/lib/microseg/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/microseg/api')>()),
  microsegApi: () => ({ resolveSuggestions: resolveMock }),
}))

const sug = (over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id: 's1', policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.5', src_zone_id: 'zw', dst_ip: '10.0.0.9', dst_zone_id: 'zd',
  proto: 'tcp', dport: '443', hits: 3, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T12:00:00Z', status: 'pending', ...over,
})

beforeEach(() => {
  resolveMock.mockReset()
})
afterEach(cleanup)

describe('ObservedKindGlyph', () => {
  it('colours a blocked flow blue and a would-be-blocked one red, as the map edges do', () => {
    const { container } = renderWithProviders(<><ObservedKindGlyph kind='blocked' /><ObservedKindGlyph kind='would_block' /></>)
    const [blocked, wouldBlock] = Array.from(container.querySelectorAll('[data-kind]'))

    expect(blocked.querySelector('i.ri-forbid-line')).toBeTruthy()
    expect(blocked.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('info.main')
    expect(wouldBlock.querySelector('i.ri-eye-line')).toBeTruthy()
    expect(wouldBlock.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('error.main')
  })
})

describe('ResolveActions', () => {
  it('names the three buttons, the accept one after acceptLabel when given', () => {
    const onResolve = vi.fn()

    renderWithProviders(<ResolveActions suggestion={sug()} busy={false} onResolve={onResolve} acceptLabel='Accept as flow web → db tcp/443' />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept as flow web → db tcp/443' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept as CIDR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onResolve.mock.calls.map(c => c[0])).toEqual(['accept', 'accept_cidr', 'dismiss'])
  })

  it('disables accept without a source zone, CIDR without a source IP, and all while busy', () => {
    const { unmount } = renderWithProviders(<ResolveActions suggestion={sug({ src_zone_id: '', src_ip: '' })} busy={false} onResolve={vi.fn()} />)

    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Accept as CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false)
    unmount()

    renderWithProviders(<ResolveActions suggestion={sug()} busy onResolve={vi.fn()} />)
    for (const name of ['Accept', 'Accept as CIDR', 'Dismiss']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ResolveActions on an outbound flow', () => {
  const out = (over: Partial<MicrosegSuggestion> = {}) => sug({ direction: 'out', dst_key: '203.0.113.10', dst_ip: '203.0.113.10', dst_zone_id: '', ...over })

  it('opens the prefix dialog and resolves with the chosen prefix', () => {
    const onResolve = vi.fn()
    renderWithProviders(<ResolveActions suggestion={out()} busy={false} onResolve={onResolve} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept as CIDR' }))
    expect(onResolve).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Accept as a network' })
    expect(within(dialog).getByText('203.0.113.0/24')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }))
    expect(onResolve).toHaveBeenCalledWith('accept_cidr', 24)
  })

  it('offers no network for many destinations', () => {
    renderWithProviders(<ResolveActions suggestion={out({ dst_key: '::/0', dst_ip: '' })} busy={false} onResolve={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Accept as CIDR' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('keeps the inbound CIDR direct, without prefix', () => {
    const onResolve = vi.fn()
    renderWithProviders(<ResolveActions suggestion={sug()} busy={false} onResolve={onResolve} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept as CIDR' }))
    expect(onResolve).toHaveBeenCalledWith('accept_cidr')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('useResolveSuggestions', () => {
  type Api = ReturnType<typeof useResolveSuggestions<string[]>>

  function mount() {
    const reloadPolicy = vi.fn(async () => 'policy')
    const reloadSuggestions = vi.fn(async () => ['fresh'])
    const api: { current: Api | null } = { current: null }

    function Probe() {
      api.current = useResolveSuggestions('c1', 7, reloadPolicy, reloadSuggestions)
      return <span data-testid='state'>{`${api.current.busy}|${api.current.failure ?? ''}`}</span>
    }
    renderWithProviders(<Probe />)
    return { api, reloadPolicy, reloadSuggestions }
  }

  it('sends the ids with the draft version, re-reads the draft and the list, and gives the fresh list back', async () => {
    resolveMock.mockResolvedValue({ version: 8 })
    const { api, reloadPolicy, reloadSuggestions } = mount()
    let outcome: ResolveOutcome<string[]> | null = null

    await act(async () => { outcome = await api.current!.resolve(['a', 'b'], 'dismiss') })

    expect(resolveMock).toHaveBeenCalledWith({ version: 7, ids: ['a', 'b'], action: 'dismiss' })
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    expect(reloadSuggestions).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ resolved: true, fresh: ['fresh'] })
    expect(screen.getByTestId('state').textContent).toBe('false|')
  })

  it('re-reads on a 409 and keeps the conflict message', async () => {
    resolveMock.mockRejectedValue(new MicrosegConflictError('moved'))
    const { api, reloadSuggestions } = mount()
    let outcome: ResolveOutcome<string[]> | null = null

    await act(async () => { outcome = await api.current!.resolve(['a'], 'accept') })

    expect(outcome).toEqual({ resolved: false, fresh: ['fresh'] })
    expect(reloadSuggestions).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state').textContent).not.toBe('false|')

    act(() => api.current!.clearFailure())
    expect(screen.getByTestId('state').textContent).toBe('false|')
  })

  it('does not re-read on another failure, and sends nothing for no id or a second call while one runs', async () => {
    resolveMock.mockRejectedValueOnce(new MicrosegApiError(400, 'INVALID', 'bad id'))
    const { api, reloadPolicy } = mount()
    let outcome: ResolveOutcome<string[]> | null = null

    await act(async () => { outcome = await api.current!.resolve(['a'], 'accept') })
    expect(outcome).toEqual({ resolved: false, fresh: undefined })
    expect(reloadPolicy).not.toHaveBeenCalled()
    expect(screen.getByTestId('state').textContent).toContain('bad id')

    await act(async () => { outcome = await api.current!.resolve([], 'accept') })
    expect(outcome).toBeNull()

    let release: () => void = () => undefined
    resolveMock.mockImplementationOnce(() => new Promise(done => { release = () => done({ version: 8 }) }))
    let first: Promise<unknown> = Promise.resolve()
    let second: ResolveOutcome<string[]> | null = { resolved: true, fresh: undefined }

    await act(async () => {
      first = api.current!.resolve(['a'], 'dismiss')
      second = await api.current!.resolve(['b'], 'dismiss')
    })
    expect(second).toBeNull()
    await act(async () => { release(); await first })
    expect(resolveMock).toHaveBeenCalledTimes(2)
  })
})
