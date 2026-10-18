/**
 * The per-guest failover and failback dialog (ui#943): one guest of a plan,
 * confirmed by name, then followed through its execution; the failback walks
 * reverse sync, cutover and completion on that one guest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryExecution } from '@/lib/orchestrator/site-recovery.types'

import GuestFailoverDialog, { type GuestDialogTarget } from './GuestFailoverDialog'

// The run log polls its own route; these tests read the dialog, not the log.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const target: GuestDialogTarget = {
  planId: 'plan-1', planName: 'i943-plan', vmId: 9943, vmName: 'i943-a', targetVmId: 59943, jobId: 'job-1', siblingCount: 1,
}

function execution(overrides: Partial<RecoveryExecution> = {}): RecoveryExecution {
  return {
    id: 'exec-1',
    plan_id: 'plan-1',
    type: 'failover',
    status: 'running',
    scope_vmid: 9943,
    started_at: '2026-10-14T08:00:00Z',
    vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'running', progress_percent: 40, step: 'fencing' }],
    ...overrides,
  }
}

function render(props: Partial<React.ComponentProps<typeof GuestFailoverDialog>> = {}) {
  const handlers = {
    onClose: vi.fn(), onFailover: vi.fn(), onStartFailback: vi.fn(), onCutover: vi.fn(), onCancelFailback: vi.fn(),
  }

  renderWithProviders(
    <GuestFailoverDialog
      open
      mode='failover'
      target={target}
      guestState={null}
      execution={null}
      restorePoints={{ loading: false, data: null, failed: false }}
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

describe('GuestFailoverDialog: failover of one guest', () => {
  it('names the guest, says the sibling keeps replicating, and arms the button only once the name is typed', async () => {
    const h = render()

    expect(screen.getByText('Failover i943-a to the DR site')).toBeInTheDocument()
    expect(screen.getByText(/VMID 59943/)).toBeInTheDocument()
    expect(screen.getByText('The other guest of the plan keeps replicating.')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Failover this VM' })

    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type i943-a to confirm'), 'i943-a')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(h.onFailover).toHaveBeenCalledWith(undefined)
  })

  it('sends the restore point the operator picked', async () => {
    const h = render({
      restorePoints: { loading: false, failed: false, data: { vm_id: 9943, vm_name: 'i943-a', target_vmid: 59943, disk_count: 1, restore_points: [{ snapshot: 'mirror-20261014100809', created_ts: 1, created_iso: '2026-10-14T08:08:09Z' }] } },
    })

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: /2026|10\/14|14\/10/ }))
    await userEvent.type(screen.getByLabelText('Type i943-a to confirm'), 'i943-a')
    await userEvent.click(screen.getByRole('button', { name: 'Failover this VM' }))
    expect(h.onFailover).toHaveBeenCalledWith('mirror-20261014100809')
  })

  it('follows the running execution with its step, and cannot be dismissed meanwhile', () => {
    const h = render({ execution: execution(), guestState: 'failing_over' })

    expect(screen.getByText('Failover in progress')).toBeInTheDocument()
    expect(screen.getByText('Stopping the source VM')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Failover this VM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('reports the guest running on the DR site once the failover completed', () => {
    render({
      guestState: 'failed_over',
      execution: execution({ status: 'completed', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'completed', progress_percent: 100, target_vmid: 59943 }] }),
    })

    expect(screen.getByText('i943-a runs on the DR site as VMID 59943. Its replication is on hold until it fails back.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })

  it('tells a fenced guest apart from one the failover never touched', () => {
    render({
      guestState: 'failed_over',
      execution: execution({ status: 'failed', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'failed', progress_percent: 50, error: 'start failed' }] }),
    })
    expect(screen.getByText(/use the failback to bring it home/)).toBeInTheDocument()
    expect(screen.getByText('start failed')).toBeInTheDocument()
    cleanup()

    render({
      guestState: null,
      execution: execution({ status: 'failed', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'failed', progress_percent: 10, error: 'no DR node' }] }),
    })
    expect(screen.getByText(/the VM is still replicating/)).toBeInTheDocument()
  })
})

describe('GuestFailoverDialog: failback of one guest', () => {
  it('starts the failback of a failed over guest, and refuses one that is not', async () => {
    const h = render({ mode: 'failback', guestState: 'failed_over' })

    expect(screen.getByText('Failback i943-a to the source site')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start failback' }))
    expect(h.onStartFailback).toHaveBeenCalled()
    cleanup()

    render({ mode: 'failback', guestState: null })
    expect(screen.getByRole('button', { name: 'Start failback' })).toBeDisabled()
  })

  it('shows the reverse sync of that guest and keeps the cutover shut until its first sync', async () => {
    const h = render({
      mode: 'failback', guestState: 'failing_back',
      execution: execution({ type: 'failback', phase: 'reverse_sync', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'pending', progress_percent: 0 }] }),
    })

    const monitor = screen.getByTestId('guest-reverse-sync')

    expect(within(monitor).getByText('No reverse sync yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cutover' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel failback' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(h.onCancelFailback).toHaveBeenCalled()
  })

  it('draws the reverse sync from the DR copy to the source, the source receiving', () => {
    render({
      mode: 'failback', guestState: 'failing_back',
      target: { ...target, sourceSite: 'PVE-PROD', targetSite: 'PVE-DR' },
      placements: { source: { node: 'pve1', status: 'stopped' }, dr: { node: 'pve1-dr', status: 'running' } },
      execution: execution({ type: 'failback', phase: 'reverse_sync', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'running', progress_percent: 0, target_vmid: 59943 }] }),
    })

    const from = screen.getByTestId('reverse-sync-from')
    const to = screen.getByTestId('reverse-sync-to')

    expect(within(from).getByText('Runs on the DR site')).toBeInTheDocument()
    expect(within(from).getByText('i943-a · 59943')).toBeInTheDocument()
    expect(within(screen.getByTestId('reverse-sync-from-cluster')).getByText('PVE-DR')).toBeInTheDocument()
    expect(within(screen.getByTestId('reverse-sync-from-node')).getByText('pve1-dr')).toBeInTheDocument()
    expect(within(from).queryByRole('progressbar')).toBeNull()
    expect(within(to).getByText('Receiving the changes')).toBeInTheDocument()
    expect(within(to).getByText('i943-a · 9943')).toBeInTheDocument()
    expect(within(screen.getByTestId('reverse-sync-to-cluster')).getByText('PVE-PROD')).toBeInTheDocument()
    expect(within(screen.getByTestId('reverse-sync-to-node')).getByText('pve1')).toBeInTheDocument()
    expect(within(to).getByRole('progressbar')).toBeInTheDocument()
  })

  it('reads 0 B for a reverse sync that had nothing to send, and - before the first one', () => {
    render({
      mode: 'failback', guestState: 'failing_back',
      execution: execution({ type: 'failback', phase: 'reverse_sync', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'running', progress_percent: 0, last_reverse_sync_at: '2026-10-16T14:35:58Z' }] }),
    })

    expect(within(screen.getByTestId('guest-reverse-sync')).getByText('0 B')).toBeInTheDocument()
  })

  it('offers the cutover once a reverse sync landed, confirmed first', async () => {
    const h = render({
      mode: 'failback', guestState: 'failing_back',
      execution: execution({ type: 'failback', phase: 'reverse_sync', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'running', progress_percent: 0, last_reverse_sync_at: '2026-10-14T08:30:00Z', last_reverse_sync_bytes: 4 * 1024 * 1024 }] }),
    })

    expect(screen.getByText('4.0 MB')).toBeInTheDocument()
    const cutover = screen.getByRole('button', { name: 'Cutover' })

    expect(cutover).toBeEnabled()
    await userEvent.click(cutover)
    expect(screen.getByText('Stop the replica of i943-a, apply the final delta and start the source VM?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(h.onCutover).toHaveBeenCalled()
  })

  it('follows the cutover steps, then reports the guest home and protected again', () => {
    render({
      mode: 'failback', guestState: 'failing_back',
      execution: execution({ type: 'failback', phase: 'cutover', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'running', progress_percent: 0, step: 'final_sync' }] }),
    })
    expect(screen.getByText('Cutover in progress')).toBeInTheDocument()
    expect(screen.getByText('Applying the final delta')).toBeInTheDocument()
    cleanup()

    render({
      mode: 'failback', guestState: null,
      execution: execution({ type: 'failback', status: 'completed', vm_results: [{ vm_id: 9943, vm_name: 'i943-a', status: 'completed', progress_percent: 100 }] }),
    })
    expect(screen.getByText('i943-a runs on the source site again and replication protects it in the original direction.')).toBeInTheDocument()
  })
})
