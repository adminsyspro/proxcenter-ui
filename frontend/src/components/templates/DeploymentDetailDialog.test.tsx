import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useTaskDetail', () => ({ useTaskDetail: () => ({ data: null }) }))

import DeploymentDetailDialog from './DeploymentDetailDialog'

const deployment = {
  id: 'deploy-1', blueprintId: null, blueprintName: null, connectionId: 'conn-1',
  node: 'pve1', vmid: 100, vmName: 'test', imageSlug: 'debian-12', status: 'failed',
  currentStep: 'failed', error: 'Permission denied', taskUpid: null, config: null,
  startedAt: '2026-09-18T00:00:00Z', completedAt: null, createdAt: '2026-09-18T00:00:00Z',
}

afterEach(cleanup)

describe('deployment detail after failure', () => {
  it('does not show an increasing duration for legacy failures without an end timestamp', () => {
    render(<DeploymentDetailDialog open deployment={deployment} onClose={() => {}} />)
    expect(screen.getByText('tasks.detail.duration').parentElement).toHaveTextContent('—')
  })

  it('uses the recorded failure timestamp and displays the selected image storage', () => {
    render(<DeploymentDetailDialog open deployment={{ ...deployment, completedAt: '2026-09-18T00:00:12Z', config: { downloadStorage: 'imports' } }} onClose={() => {}} />)
    expect(screen.getByText('tasks.detail.duration').parentElement).toHaveTextContent('12s')
    expect(screen.getByText('templates.deploy.target.imageStorage: imports')).toBeInTheDocument()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })
})
