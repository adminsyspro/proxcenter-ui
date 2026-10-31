import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('./DeploymentDetailDialog', () => ({ default: () => null }))

import DeploymentsTab from './DeploymentsTab'

const DEPLOYMENT = {
  id: 'd1', blueprintId: null, blueprintName: null, connectionId: 'c1', node: 'pve1', vmid: 110, vmName: 'web-01',
  imageSlug: 'debian-13', status: 'completed', currentStep: 'completed', error: null, taskUpid: null, config: null,
  startedAt: null, completedAt: null, createdAt: '2026-10-30T10:00:00Z',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeploymentsTab', () => {
  it('lists the deployments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [DEPLOYMENT] })))
    renderWithProviders(<DeploymentsTab />)

    expect(await screen.findByText('web-01')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })

  it('shows the empty state for a real empty history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [] })))
    renderWithProviders(<DeploymentsTab />)

    expect(await screen.findByText('No deployments yet')).toBeInTheDocument()
  })

  it('reports a failed load instead of an empty history, and retries on demand', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'database unavailable' }, 500))
      .mockResolvedValue(json({ data: [DEPLOYMENT] }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<DeploymentsTab />)

    expect(await screen.findByText('The deployments could not be loaded: database unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No deployments yet')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('web-01')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderWithProviders(<DeploymentsTab />)

    expect(await screen.findByText('The deployments could not be loaded: Failed to fetch')).toBeInTheDocument()
  })

  it('keeps the last list when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = { ...DEPLOYMENT, status: 'creating' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [running] }))
      .mockResolvedValue(json({ error: 'database unavailable' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<DeploymentsTab />)

    expect(await screen.findByText('web-01')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)

    await waitFor(() => expect(screen.getByText('The deployments could not be loaded: database unavailable')).toBeInTheDocument())
    expect(screen.getByText('web-01')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
