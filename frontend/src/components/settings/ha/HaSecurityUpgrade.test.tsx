import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import HaSecurityUpgrade from './HaSecurityUpgrade'
import type { HaConfig } from './useHaConfig'

const BASE: HaConfig = {
  enabled: true, vip: '10.0.0.9', vipInterface: 'eth0', deploymentState: 'deployed',
  deploymentStep: 0, deployedAt: null, nodes: [], securityLevel: 0, securityUpgrade: null,
}

class FakeEventSource {
  static last: FakeEventSource | null = null
  static count = 0
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeEventSource.last = this; FakeEventSource.count++ }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeEventSource.last = null
  FakeEventSource.count = 0
  vi.useRealTimers()
})

describe('HaSecurityUpgrade', () => {
  it('shows the banner only for a deployed cluster at level 0', () => {
    renderWithProviders(<HaSecurityUpgrade config={BASE} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Apply security hardening' })).toBeInTheDocument()
    cleanup()
    renderWithProviders(<HaSecurityUpgrade config={{ ...BASE, securityLevel: 1 }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply security hardening' })).not.toBeInTheDocument()
    cleanup()
    renderWithProviders(<HaSecurityUpgrade config={{ ...BASE, deploymentState: 'idle' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply security hardening' })).not.toBeInTheDocument()
  })

  it('opens a themed dialog and posts on confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const onChange = vi.fn()
    renderWithProviders(<HaSecurityUpgrade config={BASE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Apply security hardening' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Start hardening' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ha/security-upgrade', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('shows the backend message on a 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'retry in a few seconds' }) }))
    renderWithProviders(<HaSecurityUpgrade config={BASE} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Apply security hardening' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start hardening' }))

    expect(await screen.findByText('retry in a few seconds')).toBeInTheDocument()
  })

  it('shows the error and a Resume button that posts again when failed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const cfg: HaConfig = { ...BASE, securityUpgrade: { v: 1, phase: 5, nodeIndex: 1, status: 'failed', error: 'ssh timeout', startedAt: '', updatedAt: '' } }
    renderWithProviders(<HaSecurityUpgrade config={cfg} onChange={vi.fn()} />)

    expect(screen.getByText(/ssh timeout/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/ha/security-upgrade', expect.objectContaining({ method: 'POST' })))
  })

  it('shows the progress from the SSE stream while running and ignores deploy events', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const cfg: HaConfig = { ...BASE, securityUpgrade: { v: 1, phase: 2, nodeIndex: 0, status: 'running', startedAt: '', updatedAt: '' } }
    renderWithProviders(<HaSecurityUpgrade config={cfg} onChange={vi.fn()} />)

    expect(FakeEventSource.last?.url).toBe('/api/v1/ha/deploy/status')
    const send = (m: object) => act(() => { FakeEventSource.last!.onmessage!({ data: JSON.stringify(m) }) })
    send({ step: 4, totalSteps: 9, label: 'Deploy: pulling images', status: 'running' })
    send({ step: 5, totalSteps: 9, label: 'Security upgrade: recreating replica', status: 'running' })

    expect(screen.getByText(/Security hardening: step 5 of 9/)).toBeInTheDocument()
    expect(screen.getByText(/recreating replica/)).toBeInTheDocument()
    expect(screen.queryByText(/pulling images/)).not.toBeInTheDocument()
  })

  const RUNNING: HaConfig = { ...BASE, securityUpgrade: { v: 1, phase: 2, nodeIndex: 0, status: 'running', startedAt: '', updatedAt: '' } }

  it('keeps one stream and a working poll when the parent passes a new onChange', () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', FakeEventSource)
    const tick = vi.fn()
    const { rerender } = renderWithProviders(<HaSecurityUpgrade config={RUNNING} onChange={() => tick()} />)
    for (let i = 0; i < 3; i++) {
      act(() => { vi.advanceTimersByTime(2000) })
      rerender(<HaSecurityUpgrade config={RUNNING} onChange={() => tick()} />)
    }
    act(() => { vi.advanceTimersByTime(2000) })

    expect(FakeEventSource.count).toBe(1)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('writes the label with the language punctuation in one message', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithProviders(<HaSecurityUpgrade config={RUNNING} onChange={vi.fn()} />)
    act(() => { FakeEventSource.last!.onmessage!({ data: JSON.stringify({ step: 5, totalSteps: 9, label: 'Security upgrade: recreating replica', status: 'running' }) }) })

    expect(screen.getByText('Security hardening: step 5 of 9: recreating replica')).toBeInTheDocument()
  })

  it('displays the 1-based step from the persisted phase before any event', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithProviders(<HaSecurityUpgrade config={RUNNING} onChange={vi.fn()} />)

    expect(screen.getByText('Security hardening: step 3 of 9')).toBeInTheDocument()
  })

  it('keeps the action disabled after a successful start until the config reports running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) }))
    renderWithProviders(<HaSecurityUpgrade config={BASE} onChange={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply security hardening' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start hardening' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply security hardening' })).toBeDisabled())
  })

  it('shows the banner for a converted cluster whose last deploy failed, never for one never converted', () => {
    renderWithProviders(<HaSecurityUpgrade config={{ ...BASE, deploymentState: 'failed', deployedAt: '2026-10-01T00:00:00Z' }} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Apply security hardening' })).toBeInTheDocument()
    cleanup()
    renderWithProviders(<HaSecurityUpgrade config={{ ...BASE, deploymentState: 'failed', deployedAt: null }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply security hardening' })).not.toBeInTheDocument()
  })

  it('enables Resume again when the resumed run fails before running is ever seen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) }))
    const failedAt = (updatedAt: string, error: string): HaConfig => ({
      ...BASE, securityUpgrade: { v: 1, phase: 5, nodeIndex: 1, status: 'failed', error, startedAt: '', updatedAt },
    })
    const { rerender } = renderWithProviders(<HaSecurityUpgrade config={failedAt('t1', 'ssh timeout')} onChange={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled())

    rerender(<HaSecurityUpgrade config={failedAt('t2', 'etcd down')} onChange={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByText(/etcd down/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
  })

  it('ignores a malformed stream frame and keeps the progress', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithProviders(<HaSecurityUpgrade config={RUNNING} onChange={vi.fn()} />)
    act(() => { FakeEventSource.last!.onmessage!({ data: JSON.stringify({ step: 5, totalSteps: 9, label: 'Security upgrade: recreating replica', status: 'running' }) }) })
    act(() => { FakeEventSource.last!.onmessage!({ data: 'not json' }) })

    expect(screen.getByText('Security hardening: step 5 of 9: recreating replica')).toBeInTheDocument()
  })
})
