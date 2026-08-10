/**
 * Component tests for FailoverDialog's persistent "test failover active" UI
 * (issue #664, point 4).
 *
 * Before this fix, the dialog kept both the "confirm" and the "Cleanup"
 * blocks visible once a test execution had completed (`!isExecuting` stayed
 * true for any non-running status). It must now show exactly one of the two,
 * driven by whether an execution is known at all — which also covers the
 * reload case, where the execution is rehydrated from
 * `plan.active_test_execution_id` instead of living only in React state.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryPlan, RecoveryExecution } from '@/lib/orchestrator/site-recovery.types'

import FailoverDialog from './FailoverDialog'

afterEach(cleanup)

function plan(overrides: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    id: 'plan-1',
    name: 'Prod DR',
    description: '',
    status: 'ready',
    source_cluster: 'src',
    target_cluster: 'dst',
    vms: [{ vm_id: 100, vm_name: 'web-01', replication_job_id: 'job-1', tier: 1, boot_order: 1 }],
    last_test: null,
    last_failover: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function execution(overrides: Partial<RecoveryExecution> = {}): RecoveryExecution {
  return {
    id: 'exec-1',
    plan_id: 'plan-1',
    type: 'test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    vm_results: [],
    ...overrides,
  }
}

type Props = Parameters<typeof FailoverDialog>[0]

function renderDialog(overrides: Partial<Props> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()

  renderWithProviders(
    <FailoverDialog
      open
      onClose={onClose}
      plan={plan()}
      type='test'
      onConfirm={onConfirm}
      execution={null}
      {...overrides}
    />,
  )

  return { onConfirm, onClose }
}

describe('FailoverDialog', () => {
  it('hides Confirm and shows Cleanup once a test execution is known (completed)', () => {
    renderDialog({ execution: execution(), onCleanup: vi.fn() })

    expect(screen.queryByRole('button', { name: 'Test Failover' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cleanup test' })).toBeInTheDocument()
  })

  it('shows the Confirm button when there is no execution at all', () => {
    renderDialog({ execution: null })

    expect(screen.getByRole('button', { name: 'Test Failover' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cleanup test' })).not.toBeInTheDocument()
  })

  it('renders the error alert when errorMessage is set', () => {
    const message = 'A test failover is already active for this plan. Clean it up first.'
    renderDialog({ errorMessage: message })

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('disables Confirm and shows the warning banner when the plan has an unresolved active test', () => {
    renderDialog({
      plan: plan({ active_test_execution_id: 'exec-1', last_test: '2026-08-01T10:00:00Z' }),
      execution: null,
    })

    expect(screen.getByRole('button', { name: 'Test Failover' })).toBeDisabled()
    expect(screen.getByText(/awaiting cleanup/)).toBeInTheDocument()
  })
})
