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
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, userEvent, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryPlan, RecoveryExecution, PlanRestorePoints } from '@/lib/orchestrator/site-recovery.types'

import FailoverDialog from './FailoverDialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

function restorePoints(overrides: Partial<PlanRestorePoints> = {}): PlanRestorePoints {
  return {
    plan_id: 'plan-1',
    target_cluster: 'dst',
    vms: [
      {
        vm_id: 100,
        vm_name: 'web-01',
        target_vmid: 9100,
        disk_count: 1,
        restore_points: [
          { snapshot: 'snap-2', created_ts: 2, created_iso: '2026-06-15T12:00:00Z' },
          { snapshot: 'snap-1', created_ts: 1, created_iso: '2026-06-10T12:00:00Z' },
        ],
      },
    ],
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

describe('FailoverDialog restore-point selection (issue #664)', () => {
  it('renders a restore-point selector per VM, defaulting to Latest', () => {
    renderDialog({ type: 'test', restorePoints: restorePoints() })

    const select = screen.getByRole('combobox')
    expect(select).toHaveTextContent('Latest (default)')
  })

  it('shows a muted caption instead of a selector when a VM has no restore points', () => {
    renderDialog({
      type: 'test',
      restorePoints: restorePoints({ vms: [{ vm_id: 100, vm_name: 'web-01', target_vmid: 9100, disk_count: 1, restore_points: [] }] }),
    })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('No restore points')).toBeInTheDocument()
  })

  it('sends onConfirm only the non-latest selection', async () => {
    const { onConfirm } = renderDialog({
      type: 'failover',
      restorePoints: restorePoints(),
    })

    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = await screen.findAllByRole('option')
    // options[0] is "Latest (default)"; options[1] is the newest restore point (snap-2).
    await userEvent.click(options[1])

    await userEvent.type(screen.getByPlaceholderText('Prod DR'), 'Prod DR')
    await userEvent.click(screen.getByRole('button', { name: 'Execute Failover' }))

    expect(onConfirm).toHaveBeenCalledWith({ restorePoints: { 100: 'snap-2' } })
  })

  it('falls back to onConfirm() with no options when Latest stays selected', async () => {
    const { onConfirm } = renderDialog({ type: 'test', restorePoints: restorePoints() })

    await userEvent.click(screen.getByRole('button', { name: 'Test Failover' }))

    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('hides selectors and shows the info alert in degraded mode (restore points failed to load)', () => {
    renderDialog({ type: 'test', restorePointsError: true })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/Restore points could not be loaded/)).toBeInTheDocument()
  })
})

describe('FailoverDialog boot screenshot step checklist (issue #664 follow-up)', () => {
  const runningVMResults = [
    { vm_id: 100, vm_name: 'web-01', status: 'completed' as const, progress_percent: 100 },
  ]

  it('shows the stabilize step spinning while the execution phase is stabilizing', () => {
    renderDialog({
      execution: execution({ status: 'running', phase: 'stabilizing', vm_results: runningVMResults }),
    })

    const label = screen.getByText('Letting guests settle')
    const row = label.closest('div')

    expect(row?.querySelector('.ri-loader-4-line')).toBeInTheDocument()
  })

  it('shows the capture step spinning while the execution phase is capturing', () => {
    renderDialog({
      execution: execution({ status: 'running', phase: 'capturing', vm_results: runningVMResults }),
    })

    const label = screen.getByText('Capturing boot screenshots')
    const row = label.closest('div')

    expect(row?.querySelector('.ri-loader-4-line')).toBeInTheDocument()

    // The stabilize step is done by the time we're capturing.
    const stabilizeRow = screen.getByText('Letting guests settle').closest('div')

    expect(stabilizeRow?.querySelector('.ri-check-line')).toBeInTheDocument()
  })
})

describe('FailoverDialog stabilization countdown (issue #664 follow-up)', () => {
  it('appends a live countdown to the stabilize label when phase_ends_at is set', () => {
    renderDialog({
      execution: execution({
        status: 'running',
        phase: 'stabilizing',
        phase_ends_at: new Date(Date.now() + 30500).toISOString(),
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'completed', progress_percent: 100 },
        ],
      }),
    })

    expect(screen.getByText(/Letting guests settle \(3?\d s\)/)).toBeInTheDocument()
  })

  it('does not append a countdown when phase_ends_at is absent', () => {
    renderDialog({
      execution: execution({
        status: 'running',
        phase: 'stabilizing',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'completed', progress_percent: 100 },
        ],
      }),
    })

    expect(screen.getByText('Letting guests settle')).toBeInTheDocument()
  })
})

describe('FailoverDialog real-failover per-VM steps and completion summary (issue #664 follow-up)', () => {
  it('shows the translated step caption while a failover VM is running a known step', () => {
    renderDialog({
      type: 'failover',
      execution: execution({
        type: 'failover',
        status: 'running',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'running', progress_percent: 40, step: 'fencing' },
        ],
      }),
    })

    expect(screen.getByText('Stopping the source VM')).toBeInTheDocument()
  })

  it('shows a completion summary alert and hides the confirm input once a failover execution has completed', () => {
    renderDialog({
      type: 'failover',
      execution: execution({
        type: 'failover',
        status: 'completed',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'completed', progress_percent: 100 },
        ],
      }),
    })

    expect(screen.getByText('Failover complete')).toBeInTheDocument()
    expect(screen.getByText(/1\/1/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Prod DR')).not.toBeInTheDocument()
  })
})

describe('FailoverDialog failback reverse-sync monitor (issue #664 failback)', () => {
  it('renders the per-VM sync table and both action buttons during reverse_sync', () => {
    renderDialog({
      type: 'failback',
      execution: execution({
        type: 'failback',
        status: 'running',
        phase: 'reverse_sync',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'running', progress_percent: 0, last_reverse_sync_at: '2026-08-10T10:00:00Z', last_reverse_sync_bytes: 5242880 },
        ],
      }),
    })

    // "web-01" appears both in the Plan Summary list above and in the new
    // reverse-sync table — assert both are present rather than picking one.
    expect(screen.getAllByText('web-01').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(new Date('2026-08-10T10:00:00Z').toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('5 MiB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel failback' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cutover' })).toBeInTheDocument()
  })

  it('shows "No reverse sync yet" for a VM that has not synced back, and its error caption when set', () => {
    renderDialog({
      type: 'failback',
      execution: execution({
        type: 'failback',
        status: 'running',
        phase: 'reverse_sync',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'running', progress_percent: 0, error: 'disk offline' },
        ],
      }),
    })

    expect(screen.getByText('No reverse sync yet')).toBeInTheDocument()
    expect(screen.getByText('disk offline')).toBeInTheDocument()
  })

  it('opens a confirm dialog before calling onFailbackCutover, passing the plan id', async () => {
    const onFailbackCutover = vi.fn()
    renderDialog({
      type: 'failback',
      execution: execution({ type: 'failback', status: 'running', phase: 'reverse_sync', vm_results: [] }),
      onFailbackCutover,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Cutover' }))
    expect(onFailbackCutover).not.toHaveBeenCalled()
    expect(screen.getByText('Stop the DR VMs, apply the final delta and start the source VMs?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onFailbackCutover).toHaveBeenCalledWith('plan-1')
  })

  it('opens a confirm dialog before calling onFailbackCancel, passing the plan id', async () => {
    const onFailbackCancel = vi.fn()
    renderDialog({
      type: 'failback',
      execution: execution({ type: 'failback', status: 'running', phase: 'reverse_sync', vm_results: [] }),
      onFailbackCancel,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel failback' }))
    expect(onFailbackCancel).not.toHaveBeenCalled()
    expect(screen.getByText('Stop reverse replication and return the plan to failed over? Nothing is changed on the VMs.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onFailbackCancel).toHaveBeenCalledWith('plan-1')
  })
})

describe('FailoverDialog failback cutover phase (issue #664 failback)', () => {
  it('shows the translated step caption for the final_sync step', () => {
    renderDialog({
      type: 'failback',
      execution: execution({
        type: 'failback',
        status: 'running',
        phase: 'cutover',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'running', progress_percent: 60, step: 'final_sync' },
        ],
      }),
    })

    expect(screen.getByText('Applying the final delta')).toBeInTheDocument()
  })
})

describe('FailoverDialog failback completion summary (issue #664 failback)', () => {
  it('shows the failback completion summary once the execution has completed', () => {
    renderDialog({
      type: 'failback',
      execution: execution({
        type: 'failback',
        status: 'completed',
        vm_results: [
          { vm_id: 100, vm_name: 'web-01', status: 'completed', progress_percent: 100 },
        ],
      }),
    })

    expect(screen.getByText('Failback complete')).toBeInTheDocument()
    expect(screen.getByText('Source VMs are running and replication protects them again in the original direction.')).toBeInTheDocument()
  })
})

describe('FailoverDialog camera button on rehydrated results (issue #664 follow-up)', () => {
  it('shows the camera button in the Plan Summary rows for a rehydrated (non-running) execution, and opens the preview dialog on click', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        { vm_id: 100, target_vmid: 9100, captured_at: '2026-08-11T07:47:35Z' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    ))

    renderWithProviders(
      // renderWithProviders's own SWRConfig sets revalidateOnMount:false; the
      // camera button depends on the screenshots list SWR fetch actually
      // resolving, so override it back on here (same pattern as
      // ExecutionScreenshots.test.tsx).
      <SWRConfig value={{ revalidateOnMount: true }}>
        <FailoverDialog
          open
          onClose={vi.fn()}
          plan={plan()}
          type='test'
          onConfirm={vi.fn()}
          execution={execution({
            status: 'completed',
            vm_results: [
              { vm_id: 100, vm_name: 'web-01', status: 'completed', progress_percent: 100, target_node: 'dr-1', target_vmid: 9100 },
            ],
          })}
        />
      </SWRConfig>,
    )

    const cameraButton = await screen.findByRole('button', { name: 'View boot screenshot' })

    await userEvent.click(cameraButton)

    const previewImg = await screen.findByRole('img')
    expect(previewImg).toHaveAttribute('src', '/api/v1/orchestrator/replication/executions/exec-1/screenshots/100')
  })
})
