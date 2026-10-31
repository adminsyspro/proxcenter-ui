/**
 * Component tests for EmergencyDRTab's job status chip (issue #687): a job
 * whose tags currently match no VMs carries the new "no_match" status, which
 * must render as a translated warning chip, not as the raw enum value.
 */

import type { ComponentProps } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within, fireEvent, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryPlan, ReplicationJob, RestorePoint, VMRestorePoints } from '@/lib/orchestrator/site-recovery.types'

import EmergencyDRTab from './EmergencyDRTab'

afterEach(cleanup)

function job(overrides: Partial<ReplicationJob> = {}): ReplicationJob {
  return {
    storage_engine: 'rbd',
    id: 'job-1',
    name: '',
    vm_ids: [100],
    vm_names: ['web-01'],
    tags: [],
    source_cluster: 'src',
    target_cluster: 'dst',
    target_pool: 'rbd',
    vmid_prefix: 0,
    status: 'pending',
    schedule: '*/15 * * * *',
    schedule_spec: null,
    timezone: '',
    rpo_target: 900,
    last_sync: null,
    next_sync: null,
    retry_count: 0,
    next_retry_at: null,
    throughput_bps: 0,
    rate_limit_mbps: 0,
    bandwidth_windows: [],
    network_mapping: {},
    progress_percent: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderTab(jobs: ReplicationJob[], vmStatesByConn: Record<string, Record<number, string>> = {}) {
  renderWithProviders(
    <EmergencyDRTab
      jobs={jobs}
      plans={[]}
      loading={false}
      connections={[]}
      vmNamesByConn={{}}
      vmStatesByConn={vmStatesByConn}
      onStartVM={vi.fn()}
      onStopVM={vi.fn()}
      loadRestorePoints={vi.fn().mockResolvedValue({ restore_points: [] })}
      onExecuteFailover={vi.fn()}
      onExecuteFailback={vi.fn()}
    />,
  )
}

describe('EmergencyDRTab: job status glyph', () => {
  // The status is an icon now, its word carried by the tooltip (which MUI
  // exposes as the accessible name). What issue #687 asked for still holds:
  // a raw enum value must never reach the screen.
  const statusGlyph = () => (screen.getAllByRole('row')[1] as HTMLTableRowElement).cells[4].querySelector('i')

  it('renders a translated glyph for a no_match job instead of the raw value', () => {
    renderTab([job({ status: 'no_match' })])

    expect(statusGlyph()).toHaveAttribute('aria-label', 'No matching VMs')
    expect(statusGlyph()).toHaveClass('ri-filter-off-line')
    expect(screen.queryByText('no_match')).not.toBeInTheDocument()
  })

  it('renders a translated glyph for a partial job instead of the raw value', () => {
    renderTab([job({ status: 'partial' })])

    expect(statusGlyph()).toHaveAttribute('aria-label', 'Partially synced')
    expect(screen.queryByText('partial')).not.toBeInTheDocument()
  })

  it('translates the ordinary statuses too, which used to render raw', () => {
    renderTab([job({ status: 'synced' })])

    expect(statusGlyph()).toHaveAttribute('aria-label', 'Synced')
    expect(statusGlyph()).toHaveClass('ri-checkbox-circle-line')
    expect(screen.queryByText('synced')).not.toBeInTheDocument()
  })

  it('keeps an unknown status readable rather than dropping it', () => {
    renderTab([job({ status: 'brand-new-state' as any })])

    expect(statusGlyph()).toHaveAttribute('aria-label', 'brand-new-state')
  })
})

describe('EmergencyDRTab: DR replica state column (issue #944)', () => {
  // Column order of a standalone row: name, source VMID, DR VMID, replica.
  const replicaCell = () => (screen.getAllByRole('row')[1] as HTMLTableRowElement).cells[3].textContent

  it('says the replica is started, never "running", for a guest PVE reports as running', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'running' } })

    expect(replicaCell()).toBe('Started')
  })

  it('says started for a PAUSED replica too: PVE reports it as running, and a paused guest serves nothing', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'paused' } })

    expect(replicaCell()).toBe('Started')
  })

  it('renders a stopped replica as stopped', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'stopped' } })

    expect(replicaCell()).toBe('Stopped')
  })

  it('falls back to a dash when the inventory knows nothing about the replica', () => {
    renderTab([job({ vmid_prefix: 5 })], {})

    expect(replicaCell()).toBe('-')
  })

  it('reads the replica state on the TARGET cluster, not the source VMID of the same number', () => {
    renderTab([job({ vmid_prefix: 5 })], { src: { 100: 'running' }, dst: { 5100: 'stopped' } })

    expect(replicaCell()).toBe('Stopped')
  })
})

/* ------------------------------------------------------------------------ *
 * Per-guest emergency start/stop and the plan header (issue #944).
 * ------------------------------------------------------------------------ */

function point(snapshot: string, createdIso = ''): RestorePoint {
  return { snapshot, created_ts: 0, created_iso: createdIso }
}

function restorePointsOf(points: RestorePoint[], extra: Partial<VMRestorePoints> = {}): VMRestorePoints {
  return { vm_id: 100, vm_name: 'web-01', target_vmid: 100, job_id: 'job-1', disk_count: 1, restore_points: points, ...extra }
}

function plan(overrides: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    id: 'plan-1',
    name: 'Tier-1 apps',
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

type TabProps = ComponentProps<typeof EmergencyDRTab>

function harness(overrides: Partial<TabProps> = {}) {
  const props: TabProps = {
    jobs: [job({ status: 'synced' })],
    plans: [],
    loading: false,
    connections: [{ id: 'src', name: 'Paris' }, { id: 'dst', name: 'Lyon' }],
    vmNamesByConn: { src: { 100: 'web-01' } },
    vmStatesByConn: {},
    onStartVM: vi.fn().mockResolvedValue(undefined),
    onStopVM: vi.fn().mockResolvedValue(undefined),
    loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([])),
    onExecuteFailover: vi.fn(),
    onExecuteFailback: vi.fn(),
    ...overrides,
  }

  const view = renderWithProviders(<EmergencyDRTab {...props} />)

  // While a dialog is open MUI hides the page behind it from the a11y tree, so
  // the row accessors look past aria-hidden to keep working either way.
  return {
    ...view,
    props,
    rerenderWith: (next: Partial<TabProps>) => view.rerender(<EmergencyDRTab {...props} {...next} />),
  }
}

const bodyRow = (index = 1) => screen.getAllByRole('row', { hidden: true })[index] as HTMLTableRowElement
const rowActions = (index = 1) => within(bodyRow(index)).getAllByRole('button', { hidden: true })
const startAction = (index = 1) => rowActions(index)[0]
const stopAction = (index = 1) => rowActions(index)[1]

async function openStartDialog(index = 1) {
  await userEvent.click(startAction(index))

  return screen.findByRole('dialog')
}

async function openStopDialog(index = 1) {
  await userEvent.click(stopAction(index))

  return screen.findByRole('dialog')
}

describe('EmergencyDRTab: starting one replica on the DR site', () => {
  it('offers the restore points of that guest, newest first, and boots from the latest by default', async () => {
    const loadRestorePoints = vi.fn().mockResolvedValue(
      restorePointsOf([point('mirror-0915'), point('mirror-0914'), point('mirror-0913')]),
    )

    harness({ loadRestorePoints })
    const dialog = await openStartDialog()

    expect(within(dialog).getByText('Start web-01 on the DR site?')).toBeInTheDocument()
    expect(loadRestorePoints).toHaveBeenCalledWith('job-1', 100)

    const select = await within(dialog).findByRole('combobox')

    expect(select).toHaveTextContent('Latest (default)')
    fireEvent.mouseDown(select)
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual([
      'Latest (default)',
      'mirror-0915',
      'mirror-0914',
      'mirror-0913',
    ])
  })

  it('dates every restore point the orchestrator timestamps, instead of showing its snapshot id', async () => {
    const iso = '2026-09-15T08:30:00Z'

    harness({ loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([point('mirror-0915', iso)])) })
    const dialog = await openStartDialog()

    fireEvent.mouseDown(await within(dialog).findByRole('combobox'))
    expect(await screen.findByRole('option', { name: new Date(iso).toLocaleString() })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'mirror-0915' })).not.toBeInTheDocument()
  })

  it('warns that the newer snapshots survive when an older restore point is picked, and boots from it', async () => {
    const { props } = harness({
      loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([point('mirror-0915'), point('mirror-0913')])),
    })
    const dialog = await openStartDialog()

    fireEvent.mouseDown(await within(dialog).findByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'mirror-0913' }))

    expect(await within(dialog).findByText(/newer restore points are kept/)).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox')).toHaveTextContent('mirror-0913')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start VM on DR site' }))

    await waitFor(() => expect(props.onStartVM).toHaveBeenCalledWith(100, 'dst', 'job-1', 'mirror-0913'))
    expect(await screen.findByText('web-01 (VMID 100) started on DR site')).toBeInTheDocument()
  })

  it('boots from the latest replicated state when the operator picks no restore point', async () => {
    const { props } = harness({
      loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([point('mirror-0915')])),
    })
    const dialog = await openStartDialog()

    await within(dialog).findByRole('combobox')
    expect(within(dialog).queryByText(/newer restore points are kept/)).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start VM on DR site' }))

    await waitFor(() => expect(props.onStartVM).toHaveBeenCalledWith(100, 'dst', 'job-1', undefined))
  })

  it('still starts the replica on the latest state when the restore points cannot be listed', async () => {
    const { props } = harness({ loadRestorePoints: vi.fn().mockRejectedValue(new Error('orchestrator unreachable')) })
    const dialog = await openStartDialog()

    expect(await within(dialog).findByText(/Restore points could not be loaded/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start VM on DR site' }))

    await waitFor(() => expect(props.onStartVM).toHaveBeenCalledWith(100, 'dst', 'job-1', undefined))
  })

  it('says the restore points could not be loaded when the listing itself reports an error', async () => {
    harness({ loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([], { error: 'rbd: no such image' })) })
    const dialog = await openStartDialog()

    expect(await within(dialog).findByText(/Restore points could not be loaded/)).toBeInTheDocument()
  })

  it('says a guest that has never been replicated has no restore point yet', async () => {
    harness({ loadRestorePoints: vi.fn().mockResolvedValue(restorePointsOf([])) })
    const dialog = await openStartDialog()

    expect(await within(dialog).findByText('No restore points')).toBeInTheDocument()
  })

  it('counts the other guests of the job that keep replicating while this replica runs', async () => {
    harness({ jobs: [job({ status: 'synced', vm_ids: [100, 101, 102] })] })
    const dialog = await openStartDialog()

    expect(within(dialog).getByText(/The 2 other guests of its job keep going/)).toBeInTheDocument()
  })

  it('says the whole job pauses when the guest is the only one it protects', async () => {
    harness()
    const dialog = await openStartDialog()

    expect(within(dialog).getByText(/This guest is all its replication job carries/)).toBeInTheDocument()
  })

  it('refuses the start while the job is syncing, and says why', async () => {
    harness({ jobs: [job({ status: 'syncing' })] })
    const dialog = await openStartDialog()

    expect(within(dialog).getByText(/replication job is syncing right now/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Start VM on DR site' })).toBeDisabled()
  })

  it('unlocks the start on its own once the running sync ends', async () => {
    const { rerenderWith } = harness({ jobs: [job({ status: 'syncing' })] })
    const dialog = await openStartDialog()

    expect(within(dialog).getByRole('button', { name: 'Start VM on DR site' })).toBeDisabled()

    rerenderWith({ jobs: [job({ status: 'synced' })] })

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Start VM on DR site' })).toBeEnabled())
    expect(within(dialog).queryByText(/replication job is syncing right now/)).not.toBeInTheDocument()
  })

  it('leaves the replica alone when the start dialog is cancelled', async () => {
    const { props } = harness()
    const dialog = await openStartDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(props.onStartVM).not.toHaveBeenCalled()
  })

  it('dismisses the start dialog on Escape without touching the replica', async () => {
    const { props } = harness()

    await openStartDialog()
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(props.onStartVM).not.toHaveBeenCalled()
  })

  it('reports the reason when the DR site refuses to start the replica', async () => {
    harness({ onStartVM: vi.fn().mockRejectedValue(new Error('target storage is offline')) })
    const dialog = await openStartDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start VM on DR site' }))

    expect(await screen.findByText('target storage is offline')).toBeInTheDocument()
  })

  it('locks both actions of the row and shows a spinner while the start is in flight', async () => {
    let release: () => void = () => {}
    const onStartVM = vi.fn().mockImplementation(() => new Promise<void>(resolve => { release = () => resolve() }))

    harness({ onStartVM })
    const dialog = await openStartDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start VM on DR site' }))

    await waitFor(() => expect(within(bodyRow()).getByRole('progressbar', { hidden: true })).toBeInTheDocument())
    expect(startAction()).toBeDisabled()
    expect(stopAction()).toBeDisabled()

    release()
    expect(await screen.findByText('web-01 (VMID 100) started on DR site')).toBeInTheDocument()
    await waitFor(() => expect(startAction()).toBeEnabled())
  })
})

describe('EmergencyDRTab: restore points of the dialog actually open (roadmap#184)', () => {
  function twoGuests(loadRestorePoints: TabProps['loadRestorePoints']) {
    return harness({
      jobs: [job({ status: 'synced', vm_ids: [100, 200], vm_names: ['web-01', 'db-01'] })],
      vmNamesByConn: { src: { 100: 'web-01', 200: 'db-01' } },
      loadRestorePoints,
    })
  }

  it('never lists the restore points of a guest whose dialog was closed meanwhile', async () => {
    let releaseFirst!: (v: VMRestorePoints) => void
    const loadRestorePoints = vi.fn((_job: string, vmId: number) => vmId === 100
      ? new Promise<VMRestorePoints>(r => { releaseFirst = r })
      : Promise.resolve(restorePointsOf([point('mirror-of-200')], { vm_id: 200 })))

    twoGuests(loadRestorePoints)
    const first = await openStartDialog(1)

    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const second = await openStartDialog(2)
    const select = await within(second).findByRole('combobox')

    releaseFirst(restorePointsOf([point('mirror-of-100')]))
    await new Promise(r => setTimeout(r, 0))

    fireEvent.mouseDown(select)
    const options = (await screen.findAllByRole('option')).map(o => o.textContent)

    expect(options).toContain('mirror-of-200')
    expect(options).not.toContain('mirror-of-100')
  })

  it('never reports the listing failure of a guest whose dialog was closed meanwhile', async () => {
    let failFirst!: (e: Error) => void
    const loadRestorePoints = vi.fn((_job: string, vmId: number) => vmId === 100
      ? new Promise<VMRestorePoints>((_r, rej) => { failFirst = rej })
      : Promise.resolve(restorePointsOf([point('mirror-of-200')], { vm_id: 200 })))

    twoGuests(loadRestorePoints)
    const first = await openStartDialog(1)

    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const second = await openStartDialog(2)

    await within(second).findByRole('combobox')
    failFirst(new Error('orchestrator unreachable'))
    await new Promise(r => setTimeout(r, 0))

    expect(within(second).queryByText(/could not be loaded/i)).not.toBeInTheDocument()
    expect(within(second).getByRole('combobox')).toBeInTheDocument()
  })
})

describe('EmergencyDRTab: stopping a replica that runs on the DR site', () => {
  it('offers to resume the replication job the start had paused, and stops with that choice', async () => {
    const { props } = harness({ jobs: [job({ status: 'paused' })] })
    const dialog = await openStopDialog()

    expect(within(dialog).getByText('Stop web-01 on the DR site?')).toBeInTheDocument()
    expect(within(dialog).getByText(/discarded when replication resumes/)).toBeInTheDocument()

    const resume = within(dialog).getByRole('switch', { name: 'Resume replication for this job' })

    expect(resume).toBeChecked()
    await userEvent.click(resume)
    expect(resume).not.toBeChecked()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop VM on DR site' }))

    await waitFor(() => expect(props.onStopVM).toHaveBeenCalledWith(100, 'dst', 'job-1', false))
    expect(await screen.findByText('web-01 (VMID 100) stopped on DR site')).toBeInTheDocument()
  })

  it('resumes the paused job by default when the operator leaves the switch alone', async () => {
    const { props } = harness({ jobs: [job({ status: 'paused' })] })
    const dialog = await openStopDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop VM on DR site' }))

    await waitFor(() => expect(props.onStopVM).toHaveBeenCalledWith(100, 'dst', 'job-1', true))
  })

  it('offers no resume switch when the job still runs, and says the guest simply rejoins it', async () => {
    const { props } = harness({ jobs: [job({ status: 'synced' })] })
    const dialog = await openStopDialog()

    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument()
    expect(within(dialog).getByText('This guest rejoins its replication job as soon as the replica is stopped.')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop VM on DR site' }))

    await waitFor(() => expect(props.onStopVM).toHaveBeenCalledWith(100, 'dst', 'job-1', true))
  })

  it('leaves the replica running when the stop dialog is cancelled', async () => {
    const { props } = harness()
    const dialog = await openStopDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(props.onStopVM).not.toHaveBeenCalled()
  })

  it('dismisses the stop dialog on Escape without stopping the replica', async () => {
    const { props } = harness()

    await openStopDialog()
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(props.onStopVM).not.toHaveBeenCalled()
  })

  it('falls back to a generic failure when the refused stop carries no reason', async () => {
    harness({ onStopVM: vi.fn().mockRejectedValue({ status: 500 }) })
    const dialog = await openStopDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop VM on DR site' }))

    expect(await screen.findByText('Failed to stop VM')).toBeInTheDocument()
  })
})

describe('EmergencyDRTab: row actions follow the replica power state', () => {
  it('offers no start on a replica that already runs on the DR site', () => {
    harness({ vmStatesByConn: { dst: { 100: 'running' } } })

    expect(startAction()).toBeDisabled()
    expect(stopAction()).toBeEnabled()
  })

  it('offers no stop on a replica that is already down', () => {
    harness({ vmStatesByConn: { dst: { 100: 'stopped' } } })

    expect(stopAction()).toBeDisabled()
    expect(startAction()).toBeEnabled()
  })

  it('keeps both actions open when the inventory knows nothing about the replica', () => {
    harness()

    expect(startAction()).toBeEnabled()
    expect(stopAction()).toBeEnabled()
  })

  it('marks a guest whose replica is started as skipped by its job, not as synced', () => {
    harness({ jobs: [job({ status: 'synced', suspended_vmids: [100] })] })

    expect(bodyRow().cells[4].querySelector('i')).toHaveAttribute(
      'aria-label',
      'Skipped: its replica is started on the DR site',
    )
  })
})

describe('EmergencyDRTab: recovery plan header', () => {
  it('fails the whole plan over on demand while the plan is ready, and keeps failback shut', async () => {
    const { props } = harness({ plans: [plan()] })

    expect(screen.getByText('Tier-1 apps')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan failback' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Emergency Failover' }))
    expect(props.onExecuteFailover).toHaveBeenCalledWith('plan-1')
  })

  it('opens the failback of a plan that has failed over, and refuses a second failover', async () => {
    const { props } = harness({ plans: [plan({ status: 'failed_over' })] })

    expect(screen.getByText('Failed Over')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emergency Failover' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Plan failback' }))
    expect(props.onExecuteFailback).toHaveBeenCalledWith('plan-1')
  })

  it('reopens the failback already under way instead of offering to start one', async () => {
    const { props } = harness({ plans: [plan({ status: 'failing_back' })] })

    expect(screen.getByText('Failing back')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emergency Failover' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Plan failback' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open plan failback' }))
    expect(props.onExecuteFailback).toHaveBeenCalledWith('plan-1')
  })

  it('refuses another failover while one is executing', () => {
    harness({ plans: [plan({ status: 'executing' })] })

    expect(screen.getByText('Executing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emergency Failover' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Plan failback' })).toBeDisabled()
  })

  it('keeps an unknown plan status readable rather than dropping it', () => {
    harness({ plans: [plan({ status: 'brand-new-state' as RecoveryPlan['status'] })] })

    expect(screen.getByText('brand-new-state')).toBeInTheDocument()
  })

  it('names both sides of the plan with the connection names the operator knows', () => {
    harness({ plans: [plan()] })

    expect(screen.getByText('Paris → Lyon')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------------ *
 * Per-guest failover and failback (issue #943): the row of a plan guest
 * carries a production failover distinct from starting its replica, a
 * failback once it is over, and the plan reads how many guests are over.
 * ------------------------------------------------------------------------ */

describe('EmergencyDRTab: per-guest failover and failback', () => {
  // MUI puts the tooltip text on the span that wraps a button (so a disabled
  // button still has a tooltip), which is where the row's word lives.
  const labelOf = (button: HTMLElement) => button.closest('span[aria-label]')?.getAttribute('aria-label')
  const guestPlan = (guests: RecoveryPlan['guests'] = [], status: RecoveryPlan['status'] = 'ready') => plan({
    status,
    guests,
    vms: [
      { vm_id: 100, vm_name: 'web-01', replication_job_id: 'job-1', tier: 1, boot_order: 1 },
      { vm_id: 101, vm_name: 'db-01', replication_job_id: 'job-1', tier: 1, boot_order: 2 },
    ],
  })
  const twoGuests = () => job({ status: 'synced', vm_ids: [100, 101], vm_names: ['web-01', 'db-01'] })

  it('offers a production failover on a protected guest, apart from the replica start, and names it as such', async () => {
    const onGuestFailover = vi.fn()
    const { props } = harness({ jobs: [twoGuests()], plans: [guestPlan()], onGuestFailover, onGuestFailback: vi.fn() })

    expect(labelOf(startAction())).toBe('Start the replica on the DR site (test, not a failover)')
    const failover = within(bodyRow()).getByTestId('guest-failover-100')

    expect(labelOf(failover)).toBe('Failover this VM')
    expect(failover).toBeEnabled()
    await userEvent.click(failover)
    expect(onGuestFailover).toHaveBeenCalledWith(expect.objectContaining({ vmId: 100, planId: 'plan-1', siblingCount: 1 }))
    expect(props.onExecuteFailover).not.toHaveBeenCalled()
  })

  it('offers no per-guest failover on a standalone replica, which has no plan to hold its state', () => {
    harness({ onGuestFailover: vi.fn(), onGuestFailback: vi.fn() })

    expect(rowActions()).toHaveLength(2)
  })

  it('locks the replica start and stop of a failed over guest, shows its state, and offers its failback', async () => {
    const onGuestFailback = vi.fn()
    harness({
      jobs: [twoGuests()],
      plans: [guestPlan([{ vm_id: 100, state: 'failed_over', execution_id: 'exec-1', job_id: 'job-1', failed_over_at: null, updated_at: '' }], 'partially_failed_over')],
      onGuestFailover: vi.fn(), onGuestFailback,
    })

    expect(startAction()).toBeDisabled()
    expect(stopAction()).toBeDisabled()
    expect(labelOf(startAction())).toBe('This VM is failed over: the replica is production. Use its failback.')
    expect(bodyRow().cells[4].querySelector('i')).toHaveAttribute('aria-label', 'Failed over')
    const failback = within(bodyRow()).getByTestId('guest-failback-100')

    expect(labelOf(failback)).toBe('Failback this VM')
    await userEvent.click(failback)
    expect(onGuestFailback).toHaveBeenCalledWith(expect.objectContaining({ vmId: 100, guestState: 'failed_over' }))

    // The sibling is untouched: it still offers its own failover.
    expect(within(bodyRow(2)).getByTestId('guest-failover-101')).toBeEnabled()
    expect(bodyRow(2).cells[4].querySelector('i')).toHaveAttribute('aria-label', 'Synced')
  })

  it('shows a guest failing over as in progress, and one failing back with its follow-up', () => {
    harness({
      jobs: [twoGuests()],
      plans: [guestPlan([
        { vm_id: 100, state: 'failing_over', execution_id: 'exec-1', job_id: 'job-1', failed_over_at: null, updated_at: '' },
        { vm_id: 101, state: 'failing_back', execution_id: 'exec-2', job_id: 'job-1', failed_over_at: null, updated_at: '' },
      ], 'partially_failed_over')],
      onGuestFailover: vi.fn(), onGuestFailback: vi.fn(),
    })

    expect(within(bodyRow()).getByTestId('guest-failover-100')).toBeDisabled()
    expect(labelOf(within(bodyRow()).getByTestId('guest-failover-100'))).toBe('Failover in progress')
    expect(bodyRow().cells[4].querySelector('i')).toHaveAttribute('aria-label', 'Failing over')
    expect(labelOf(within(bodyRow(2)).getByTestId('guest-failback-101'))).toBe('Open the failback of this VM')
    expect(bodyRow(2).cells[4].querySelector('i')).toHaveAttribute('aria-label', 'Failing back')
  })

  it('counts the guests over in the plan chip and opens the plan failback on a partially failed over plan', async () => {
    const { props } = harness({
      jobs: [twoGuests()],
      plans: [guestPlan([{ vm_id: 100, state: 'failed_over', execution_id: 'exec-1', job_id: 'job-1', failed_over_at: null, updated_at: '' }], 'partially_failed_over')],
      onGuestFailover: vi.fn(), onGuestFailback: vi.fn(),
    })

    expect(screen.getByText('1 of 2 guests failed over')).toBeInTheDocument()
    const planFailback = screen.getByRole('button', { name: 'Plan failback' })

    expect(planFailback).toBeEnabled()
    await userEvent.click(planFailback)
    expect(props.onExecuteFailback).toHaveBeenCalledWith('plan-1')
    // The plan failover stays open: it promotes the guests still protected.
    expect(screen.getByRole('button', { name: 'Emergency Failover' })).toBeEnabled()
  })

  it('keeps the per-guest failover shut while the plan itself is executing or failed over as a whole', () => {
    harness({ jobs: [twoGuests()], plans: [guestPlan([], 'executing')], onGuestFailover: vi.fn(), onGuestFailback: vi.fn() })

    expect(within(bodyRow()).getByTestId('guest-failover-100')).toBeDisabled()
    expect(labelOf(within(bodyRow()).getByTestId('guest-failover-100'))).toBe('The plan is busy: wait for its execution to finish')
  })
})
