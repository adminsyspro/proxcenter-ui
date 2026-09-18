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
