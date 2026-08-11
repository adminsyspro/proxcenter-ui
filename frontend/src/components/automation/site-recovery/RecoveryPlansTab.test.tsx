/**
 * Component tests for RecoveryPlansTab's "test failover active" indicators
 * (issue #664, point 4).
 *
 * `active_test_execution_id` is set by the backend while a test failover's
 * cleanup is still pending and survives a page reload (unlike the old
 * React-only `activeExecution` state). The row must show a warning chip and
 * the drawer must block a second test failover until cleanup runs.
 */

import { useState } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryExecution, RecoveryPlan } from '@/lib/orchestrator/site-recovery.types'

import RecoveryPlansTab from './RecoveryPlansTab'

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

// RecoveryPlansTab is controlled: the drawer's open/closed state lives in the
// component, but which plan is selected is driven by the parent. This small
// harness plays the parent's role so clicking a row actually opens the drawer.
function Harness({
  plans,
  history = [],
  onTestFailover,
  onCleanupTest,
  onHistoryCleared,
}: {
  plans: RecoveryPlan[]
  history?: RecoveryExecution[]
  onTestFailover: (id: string) => void
  onCleanupTest: (id: string) => void
  onHistoryCleared?: () => void
}) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  return (
    <RecoveryPlansTab
      plans={plans}
      loading={false}
      history={history}
      historyLoading={false}
      selectedPlanId={selectedPlanId}
      onSelectPlan={setSelectedPlanId}
      onTestFailover={onTestFailover}
      onFailover={vi.fn()}
      onFailback={vi.fn()}
      onDeletePlan={vi.fn()}
      onCleanupTest={onCleanupTest}
      onHistoryCleared={onHistoryCleared}
      connections={[]}
    />
  )
}

function renderTab(plans: RecoveryPlan[], history: RecoveryExecution[] = []) {
  const onTestFailover = vi.fn()
  const onCleanupTest = vi.fn()
  const onHistoryCleared = vi.fn()

  renderWithProviders(
    <Harness
      plans={plans}
      history={history}
      onTestFailover={onTestFailover}
      onCleanupTest={onCleanupTest}
      onHistoryCleared={onHistoryCleared}
    />,
  )

  return { onTestFailover, onCleanupTest, onHistoryCleared }
}

const openDrawer = async () => userEvent.click(screen.getByText('Prod DR'))

function execution(overrides: Partial<RecoveryExecution> = {}): RecoveryExecution {
  return {
    id: 'exec-1',
    plan_id: 'plan-1',
    type: 'failover',
    status: 'completed',
    started_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('RecoveryPlansTab — cleanup pending indicators', () => {
  it('shows the "Cleanup pending" chip and a disabled Test Failover + Cleanup button when a test is active', async () => {
    const { onCleanupTest } = renderTab([plan({ active_test_execution_id: 'exec-1' })])

    expect(screen.getByText('Cleanup pending')).toBeInTheDocument()

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).toBeDisabled()

    const cleanupButton = screen.getByRole('button', { name: 'Cleanup test' })
    await userEvent.click(cleanupButton)
    expect(onCleanupTest).toHaveBeenCalledWith('plan-1')
  })

  it('shows the "Test failover in progress" chip and no Cleanup button while the test is still executing', async () => {
    renderTab([plan({ active_test_execution_id: 'exec-1', status: 'executing' })])

    expect(screen.getByText('Test failover in progress')).toBeInTheDocument()
    expect(screen.queryByText('Cleanup pending')).not.toBeInTheDocument()

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cleanup test' })).not.toBeInTheDocument()
  })

  it('shows no chip, an enabled Test Failover button and no Cleanup button when no test is active', async () => {
    renderTab([plan({ active_test_execution_id: null })])

    expect(screen.queryByText('Cleanup pending')).not.toBeInTheDocument()

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cleanup test' })).not.toBeInTheDocument()
  })
})

describe('RecoveryPlansTab — failed-over lockdown', () => {
  it('disables Test Failover and Failover but keeps Failback enabled and Delete present', async () => {
    renderTab([plan({ status: 'failed_over' })])

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Failover' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Failback' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('leaves Test Failover and Failover enabled for a ready plan', async () => {
    renderTab([plan({ status: 'ready' })])

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Failover' })).not.toBeDisabled()
  })
})

describe('RecoveryPlansTab — clear execution history', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the clear-history button when history has entries', async () => {
    renderTab([plan()], [execution()])

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Clear history' })).toBeInTheDocument()
  })

  it('hides the clear-history button when history is empty', async () => {
    renderTab([plan()], [])

    await openDrawer()

    expect(screen.queryByRole('button', { name: 'Clear history' })).not.toBeInTheDocument()
  })

  it('opens a confirm dialog on click', async () => {
    renderTab([plan()], [execution()])

    await openDrawer()
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }))

    expect(screen.getByText(/Delete all past executions of this plan/)).toBeInTheDocument()
  })

  it('calls DELETE on the plan history endpoint and notifies the parent on confirm', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ deleted: 2 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const { onHistoryCleared } = renderTab([plan()], [execution()])

    await openDrawer()
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/orchestrator/replication/plans/plan-1/history',
      { method: 'DELETE' },
    )
    await waitFor(() => expect(onHistoryCleared).toHaveBeenCalled())
  })
})
