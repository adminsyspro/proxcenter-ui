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
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryPlan } from '@/lib/orchestrator/site-recovery.types'

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
  onTestFailover,
  onCleanupTest,
}: {
  plans: RecoveryPlan[]
  onTestFailover: (id: string) => void
  onCleanupTest: (id: string) => void
}) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  return (
    <RecoveryPlansTab
      plans={plans}
      loading={false}
      history={[]}
      historyLoading={false}
      selectedPlanId={selectedPlanId}
      onSelectPlan={setSelectedPlanId}
      onTestFailover={onTestFailover}
      onFailover={vi.fn()}
      onFailback={vi.fn()}
      onDeletePlan={vi.fn()}
      onCleanupTest={onCleanupTest}
      connections={[]}
    />
  )
}

function renderTab(plans: RecoveryPlan[]) {
  const onTestFailover = vi.fn()
  const onCleanupTest = vi.fn()

  renderWithProviders(
    <Harness plans={plans} onTestFailover={onTestFailover} onCleanupTest={onCleanupTest} />,
  )

  return { onTestFailover, onCleanupTest }
}

const openDrawer = async () => userEvent.click(screen.getByText('Prod DR'))

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

  it('shows no chip, an enabled Test Failover button and no Cleanup button when no test is active', async () => {
    renderTab([plan({ active_test_execution_id: null })])

    expect(screen.queryByText('Cleanup pending')).not.toBeInTheDocument()

    await openDrawer()

    expect(screen.getByRole('button', { name: 'Test Failover' })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cleanup test' })).not.toBeInTheDocument()
  })
})
