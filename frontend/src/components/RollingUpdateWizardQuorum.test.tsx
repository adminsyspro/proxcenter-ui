/**
 * The pre-flight step of RollingUpdateWizard, for roadmap#26.
 *
 * The orchestrator used to send English sentences and a node count. It now
 * sends a code with its values beside the sentence, and the votes the quorum
 * verdict rests on. These tests cover both directions: a code the wizard
 * knows is written in the operator's language, a code it does not know still
 * shows the orchestrator's sentence rather than nothing.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RollingUpdateWizard from './RollingUpdateWizard'

afterEach(cleanup)

const nodes = [
  { node: 'nsk-pve101', version: '9.2.2', vms: 4, status: 'online' as const },
  { node: 'nsk-pve102', version: '9.2.2', vms: 3, status: 'online' as const },
]

const basePreflight = {
  can_proceed: true,
  warnings: [],
  errors: [],
  findings: [],
  repo_issues: [],
  nodes_health: [],
  updates_available: [],
  migration_plan: { total_vms: 0, vms_to_migrate: 0, vms_to_shutdown: 0, estimated_duration_minutes: 0, node_plans: [], resource_warnings: [] },
  estimated_time_minutes: 0,
}

async function runPreflight(preflight: Record<string, any>) {
  server.use(
    http.get('*/api/v1/connections/conn-1', () => HttpResponse.json({ data: { sshEnabled: true } })),
    http.post('*/api/v1/orchestrator/rolling-updates/preflight', () =>
      HttpResponse.json({ data: { ...basePreflight, ...preflight } }),
    ),
  )

  renderWithProviders(
    <RollingUpdateWizard open onClose={vi.fn()} connectionId="conn-1" nodes={nodes} nodeUpdates={{}} />,
  )

  await userEvent.click(screen.getByRole('button', { name: /Verify|Check/i }))
}

describe('RollingUpdateWizard pre-flight findings', () => {
  it('shows the votes behind the quorum, and names the QDevice that carries them', async () => {
    await runPreflight({
      cluster_health: {
        healthy: true, quorum_ok: true, total_nodes: 2, online_nodes: 2,
        expected_votes: 3, online_votes: 3, required_votes: 2,
        qdevice: true, qdevice_votes: 1, qdevice_offline: false, issues: [],
      },
    })

    // Two nodes, three votes: the tile is the whole explanation of why a
    // two node cluster is allowed to start a rolling update.
    await waitFor(() => expect(screen.getByText('3/3')).toBeInTheDocument())
    expect(screen.getByText('Votes with QDevice, quorum 2')).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('writes a known finding in the operator language, with its values', async () => {
    await runPreflight({
      can_proceed: false,
      errors: ['Taking a node offline would leave 1 of 2 votes, and 2 are needed for quorum'],
      findings: [
        {
          severity: 'error',
          code: 'quorum_would_be_lost',
          message: 'Taking a node offline would leave 1 of 2 votes, and 2 are needed for quorum',
          context: { remaining: 1, online: 2, required: 2, expected: 2, qdevice: false },
        },
      ],
      cluster_health: {
        healthy: true, quorum_ok: true, total_nodes: 2, online_nodes: 2,
        expected_votes: 2, online_votes: 2, required_votes: 2,
        qdevice: false, qdevice_votes: 0, qdevice_offline: false, issues: [],
      },
    })

    await waitFor(() =>
      expect(screen.getByText('Taking a node offline would leave 1 of 2 votes, and quorum needs 2.')).toBeInTheDocument(),
    )
    // The tile says the same thing in numbers, without the QDevice mention.
    expect(screen.getByText('Votes, quorum 2')).toBeInTheDocument()
  })

  it('falls back to the orchestrator sentence for a code it does not know', async () => {
    const message = 'Node pve2: the enterprise repository is enabled without a subscription'

    await runPreflight({
      can_proceed: false,
      errors: [message],
      findings: [{ severity: 'error', code: 'node_issue', message, context: { node: 'pve2' } }],
      cluster_health: {
        healthy: true, quorum_ok: true, total_nodes: 2, online_nodes: 2,
        expected_votes: 3, online_votes: 3, required_votes: 2,
        qdevice: true, qdevice_votes: 1, qdevice_offline: false, issues: [],
      },
    })

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
  })

  it('reads the plain lists when the orchestrator predates the findings', async () => {
    const message = 'Only 2 healthy nodes, need at least 3 to safely update'

    await runPreflight({
      can_proceed: false,
      errors: [message],
      findings: undefined,
      cluster_health: { healthy: true, quorum_ok: true, total_nodes: 2, online_nodes: 2, issues: [] },
    })

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
    // No votes, no tile: an older orchestrator sends no vote arithmetic.
    expect(screen.queryByText(/quorum 2/)).not.toBeInTheDocument()
  })

  it('warns when a configured QDevice stopped answering', async () => {
    await runPreflight({
      can_proceed: false,
      warnings: ['The QDevice is configured but not connected, so it no longer votes'],
      errors: ['Taking a node offline would leave 1 of 2 votes, and 2 are needed for quorum'],
      findings: [
        {
          severity: 'error',
          code: 'quorum_would_be_lost',
          message: 'Taking a node offline would leave 1 of 2 votes, and 2 are needed for quorum',
          context: { remaining: 1, online: 2, required: 2, expected: 3, qdevice: true, qdeviceOffline: true },
        },
        {
          severity: 'warning',
          code: 'qdevice_offline',
          message: 'The QDevice is configured but not connected, so it no longer votes',
          context: { votes: 1 },
        },
      ],
      cluster_health: {
        healthy: true, quorum_ok: true, total_nodes: 2, online_nodes: 2,
        expected_votes: 3, online_votes: 2, required_votes: 2,
        qdevice: true, qdevice_votes: 1, qdevice_offline: true, issues: [],
      },
    })

    await waitFor(() =>
      expect(screen.getByText('The QDevice is configured but not connected, so it no longer votes.')).toBeInTheDocument(),
    )
    // Two votes out of the three corosync still expects.
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })
})
