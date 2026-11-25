import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import HaImageUpdate from './HaImageUpdate'
import type { HaConfig, HaImageStatus } from './useHaConfig'

const useHaImagesMock = vi.fn()
vi.mock('./useHaConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('./useHaConfig')>()),
  useHaImages: (enabled?: boolean) => useHaImagesMock(enabled),
}))

const BASE: HaConfig = {
  enabled: true, vip: '10.0.0.9', vipInterface: 'eth0', deploymentState: 'deployed',
  deploymentStep: 0, deployedAt: null, nodes: [], securityLevel: 1, securityUpgrade: null, imageUpdate: null,
}

const OUTDATED: HaImageStatus = {
  etcd: 'v3.5.36', haproxy: '3.4.8-alpine', outdated: true, checkedAt: '2026-11-25T12:00:00Z',
  nodes: [{ node: 'proxcenter-1', etcd: 'v3.5.17', haproxy: '2.9-alpine', outdated: true }],
}
const CURRENT: HaImageStatus = { ...OUTDATED, outdated: false, nodes: [] }

const refreshImages = vi.fn()
const withImages = (data: HaImageStatus | undefined) => useHaImagesMock.mockReturnValue({ data, mutate: refreshImages })

class FakeEventSource {
  static last: FakeEventSource | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeEventSource.last = this }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  FakeEventSource.last = null
})

describe('HaImageUpdate', () => {
  it('shows the banner, with the target tags, only for a hardened cluster whose nodes are outdated', () => {
    withImages(OUTDATED)
    renderWithProviders(<HaImageUpdate config={BASE} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Update the images' })).toBeInTheDocument()
    expect(screen.getByText(/etcd v3\.5\.36, HAProxy 3\.4\.8-alpine/)).toBeInTheDocument()
    expect(useHaImagesMock).toHaveBeenLastCalledWith(true)

    cleanup()
    withImages(CURRENT)
    renderWithProviders(<HaImageUpdate config={BASE} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Update the images' })).not.toBeInTheDocument()

    // Level 0: the security upgrade brings the images; the nodes are not even asked.
    cleanup()
    withImages(OUTDATED)
    renderWithProviders(<HaImageUpdate config={{ ...BASE, securityLevel: 0 }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Update the images' })).not.toBeInTheDocument()
    expect(useHaImagesMock).toHaveBeenLastCalledWith(false)

    cleanup()
    renderWithProviders(<HaImageUpdate config={{ ...BASE, deploymentState: 'idle' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Update the images' })).not.toBeInTheDocument()
  })

  it('opens a themed dialog and posts on confirm only', async () => {
    withImages(OUTDATED)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const onChange = vi.fn()
    renderWithProviders(<HaImageUpdate config={BASE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update the images' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText('etcd first, then HAProxy, one node at a time')).toBeInTheDocument()
    expect(screen.getByText('Outage')).toBeInTheDocument()
    expect(screen.getByText('A few seconds per node, no switchover')).toBeInTheDocument()
    expect(screen.getByText('This interface')).toBeInTheDocument()
    expect(screen.getByText(/the node holding the VIP takes its turn/)).toBeInTheDocument()
    expect(screen.getByText('Nothing is lost')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start the update' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ha/images/update', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // The accepted start keeps the action disabled until the config shows the run.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update the images' })).toBeDisabled())
  })

  it('shows the backend message on a 409', async () => {
    withImages(OUTDATED)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'an HA operation is in progress' }) }))
    renderWithProviders(<HaImageUpdate config={BASE} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update the images' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start the update' }))

    expect(await screen.findByText('an HA operation is in progress')).toBeInTheDocument()
  })

  it('shows the error and a button that starts again, without a dialog, when failed', async () => {
    withImages(OUTDATED)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const cfg: HaConfig = { ...BASE, imageUpdate: { v: 1, phase: 1, nodeIndex: 1, status: 'failed', error: 'etcd not healthy on proxcenter-3', startedAt: '', updatedAt: '' } }
    renderWithProviders(<HaImageUpdate config={cfg} onChange={vi.fn()} />)

    expect(screen.getByText(/etcd not healthy on proxcenter-3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/ha/images/update', expect.objectContaining({ method: 'POST' })))
  })

  it('shows the progress from the SSE stream while running and ignores the other runs', () => {
    withImages(OUTDATED)
    vi.stubGlobal('EventSource', FakeEventSource)
    const cfg: HaConfig = { ...BASE, imageUpdate: { v: 1, phase: 1, nodeIndex: 0, status: 'running', startedAt: '', updatedAt: '' } }
    renderWithProviders(<HaImageUpdate config={cfg} onChange={vi.fn()} />)

    expect(screen.getByText(/Image update: step 2 of 3/)).toBeInTheDocument()
    expect(FakeEventSource.last?.url).toBe('/api/v1/ha/deploy/status')
    const send = (m: object) => act(() => { FakeEventSource.last!.onmessage!({ data: JSON.stringify(m) }) })
    send({ step: 5, totalSteps: 9, label: 'Security upgrade: recreating replica', status: 'running' })
    expect(screen.queryByText(/recreating replica/)).not.toBeInTheDocument()
    send({ step: 3, totalSteps: 3, label: 'Image update: HAProxy, node by node', status: 'running' })

    expect(screen.getByText(/Image update: step 3 of 3: HAProxy, node by node/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update the images' })).not.toBeInTheDocument()
  })

  it('asks the nodes again and confirms once the run is done', () => {
    withImages(OUTDATED)
    vi.stubGlobal('EventSource', FakeEventSource)
    const running: HaConfig = { ...BASE, imageUpdate: { v: 1, phase: 2, nodeIndex: 2, status: 'running', startedAt: '', updatedAt: '' } }
    const { rerender } = renderWithProviders(<HaImageUpdate config={running} onChange={vi.fn()} />)

    withImages(CURRENT)
    rerender(<HaImageUpdate config={{ ...BASE, imageUpdate: { v: 1, phase: 3, nodeIndex: 0, status: 'done', startedAt: '', updatedAt: 'later' } }} onChange={vi.fn()} />)

    expect(refreshImages).toHaveBeenCalled()
    expect(screen.getByText('etcd and HAProxy images updated.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update the images' })).not.toBeInTheDocument()
  })
})
