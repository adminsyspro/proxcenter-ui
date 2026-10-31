import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useTaskDetail', () => ({ useTaskDetail: () => ({ data: null }) }))

import DeploymentProgress from './DeploymentProgress'

const REFUSAL =
  "No active, writable file-based storage with Import content enabled is available on node 'pve1'."

// The component reads the body with res.text() and parses it itself.
function respondWith(deployment: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ data: deployment }) })),
  )
}

const failed = {
  id: 'deploy-1', status: 'failed', currentStep: 'downloading', error: REFUSAL,
  connectionId: 'conn-1', node: 'pve1', taskUpid: null, config: null,
}

beforeEach(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('deployment progress on failure', () => {
  it('shows why the deployment failed instead of a bare red bar', async () => {
    respondWith(failed)
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={() => {}} />)
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('still shows the reason for a row that recorded no failing step', async () => {
    // Deployments written before #967 overwrote currentStep with "failed",
    // which is not a step: the banner must not depend on resolving one.
    respondWith({ ...failed, currentStep: 'failed' })
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={() => {}} />)
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('reports the failure to the wizard with the message', async () => {
    const onComplete = vi.fn()
    respondWith(failed)
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={onComplete} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('failed', REFUSAL))
  })

  it('shows no failure banner while the deployment is still running', async () => {
    // Await a field that only the polled payload can produce: the step labels
    // are static, so asserting on one would pass even if the poll never ran.
    respondWith({ ...failed, status: 'downloading', error: null, config: { downloadStorage: 'local' } })
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={() => {}} />)
    expect(await screen.findByText('templates.deploy.target.imageStorage: local')).toBeInTheDocument()
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument()
  })
})

describe('deployment progress when the status cannot be read', () => {
  function respondStatus(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetchMock)

    return fetchMock
  }

  it('ends the wait on a 404 with the reason, instead of a spinner forever', async () => {
    const onComplete = vi.fn()
    respondStatus(404, { error: 'Deployment not found' })
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={onComplete} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('failed', 'templates.deploy.statusUnreadable'))
    expect(await screen.findByText('templates.deploy.statusUnreadable')).toBeInTheDocument()
  })

  it('ends the wait on a 200 that carries no deployment', async () => {
    const onComplete = vi.fn()
    respondStatus(200, {})
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={onComplete} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('failed', 'templates.deploy.statusUnreadable'))
  })

  it('keeps waiting through a transient 502 proxy page and picks the status up again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onComplete = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
      .mockResolvedValue(new Response(JSON.stringify({ data: { ...failed, status: 'completed', error: null } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={onComplete} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(onComplete).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('completed'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after a network failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onComplete = vi.fn()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(JSON.stringify({ data: { ...failed, status: 'completed', error: null } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DeploymentProgress deploymentId="deploy-1" onComplete={onComplete} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(5000)

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('completed'))
  })
})
