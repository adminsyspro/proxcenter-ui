import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RollingUpdateWizard from './RollingUpdateWizard'

afterEach(cleanup)

const baseRun = {
  id: 'ru-1',
  connection_id: 'conn-1',
  status: 'running',
  config: {},
  total_nodes: 3,
  completed_nodes: 0,
  current_node: 'pve1',
  node_statuses: [],
  logs: [],
  created_at: '2026-08-28T12:00:00.000Z'
}

function renderMonitor(run: Record<string, unknown>, ...handlers: Parameters<typeof server.use>) {
  server.use(
    http.get('*/api/v1/connections/conn-1', () => HttpResponse.json({ data: { sshEnabled: true } })),
    http.get('*/api/v1/orchestrator/rolling-updates/ru-1', () => HttpResponse.json({ data: run })),
    ...handlers
  )

  renderWithProviders(
    <RollingUpdateWizard
      open
      onClose={vi.fn()}
      connectionId='conn-1'
      nodes={[]}
      nodeUpdates={{}}
      resumeRollingUpdateId='ru-1'
    />
  )
}

describe('RollingUpdateWizard progress monitoring', () => {
  it('shows approval feedback and posts approval for the pending node', async () => {
    let approveCalls = 0
    const run = {
      ...baseRun,
      status: 'paused',
      completed_nodes: 1,
      current_node: 'pve2',
      pending_approval: 'pve2',
      node_statuses: [
        { node_name: 'pve1', status: 'completed', reboot_required: false, did_reboot: false },
        { node_name: 'pve2', status: 'pending', reboot_required: false, did_reboot: false },
        { node_name: 'pve3', status: 'pending', reboot_required: false, did_reboot: false }
      ]
    }

    renderMonitor(
      run,
      http.post('*/api/v1/orchestrator/rolling-updates/ru-1/approve', () => {
        approveCalls += 1
        return HttpResponse.json({ data: { status: 'approved' } })
      })
    )

    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    expect(await screen.findByText(
      'The run is paused and waits for your approval before updating pve2. Approve to continue, or cancel to stop here.'
    )).toBeInTheDocument()
    const approveButton = await screen.findByRole('button', { name: /Approve pve2/ })
    expect(screen.queryByRole('button', { name: /^Resume$/ })).not.toBeInTheDocument()

    await userEvent.click(approveButton)

    await waitFor(() => expect(approveCalls).toBe(1))
  })

  it('offers resume rather than approval for a paused run without a pending node', async () => {
    renderMonitor({
      ...baseRun,
      status: 'paused',
      node_statuses: [
        { node_name: 'pve1', status: 'updating', reboot_required: false, did_reboot: false }
      ]
    })

    expect(await screen.findByRole('button', { name: /^Resume$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
  })

  it('shows package-level progress while the current node is updating', async () => {
    renderMonitor({
      ...baseRun,
      status: 'running',
      current_node: 'pve1',
      node_statuses: [
        {
          node_name: 'pve1',
          status: 'updating',
          reboot_required: false,
          did_reboot: false,
          package_progress: { phase: 'configure', done: 56, total: 245 }
        }
      ]
    })

    expect(await screen.findByText(/^In progress: pve1 • Configuring packages 56\/245$/)).toBeInTheDocument()
    const progressbar = await screen.findByRole('progressbar', { name: 'Progress: 0 / 3 nodes' })
    const value = Number(progressbar.getAttribute('aria-valuenow'))

    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(100)
  })

  it('opens failed-node output and keeps completed-node output collapsed', async () => {
    const failedOutput = 'Err:2 https://enterprise.proxmox.com/debian/pve trixie InRelease\n  401  Unauthorized\nE: Failed to fetch ... 401 Unauthorized'

    renderMonitor({
      ...baseRun,
      status: 'failed',
      error: 'Failed on node pve1: apt update failed: ...',
      completed_nodes: 1,
      node_statuses: [
        {
          node_name: 'pve1',
          status: 'failed',
          reboot_required: false,
          did_reboot: false,
          error: 'apt update failed',
          update_output: failedOutput
        },
        {
          node_name: 'pve2',
          status: 'completed',
          reboot_required: false,
          did_reboot: false,
          update_output: 'Setting up pve-manager ...'
        }
      ]
    })

    expect(await screen.findByText(/Failed on node pve1: apt update failed/)).toBeInTheDocument()
    expect(screen.getByTestId('rolling-update-output-pve1').textContent).toContain('401  Unauthorized')
    const showCompletedOutput = await screen.findByRole('button', { name: 'Show apt output' })
    expect(screen.queryByTestId('rolling-update-output-pve2')).not.toBeInTheDocument()

    await userEvent.click(showCompletedOutput)

    expect(screen.getByTestId('rolling-update-output-pve2')).toHaveTextContent('Setting up pve-manager ...')
  })
})
