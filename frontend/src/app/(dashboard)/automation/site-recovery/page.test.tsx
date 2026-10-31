import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationStorages } from '@/lib/orchestrator/site-recovery.types'

const state = vi.hoisted(() => ({
  connections: [] as Array<{ id: string; name: string; hasCeph: boolean }>,
  discovery: {} as Record<string, { data?: ReplicationStorages; error?: Error; isLoading?: boolean }>,
  jobs: [] as Array<{ id: string }>, plans: [] as Array<{ id: string; name?: string }>, jobsLoading: false,
  vms: [] as Array<Record<string, unknown>>,
  startError: vi.fn(), stopError: vi.fn(), restorePoints: vi.fn(), restorePointsError: vi.fn(),
  createOk: vi.fn(), createError: vi.fn(),
  health: { engines: ['rbd', 'zfs'] }, mutate: vi.fn(), mutateVMs: vi.fn(), pageTitle: vi.fn(), swr: vi.fn(),
}))

// The network side of the emergency actions has its own unit tests
// (src/lib/site-recovery/emergencyActions.test.ts); here the four request
// helpers are wrapped in spies so what the page hands them is visible, while
// buildVmStatesByConn and scheduleRefreshes stay the real thing — the page's
// own mapping and its refresh burst are what these tests are about.
const emergency = vi.hoisted(() => ({
  actual: null as unknown as typeof import('@/lib/site-recovery/emergencyActions'),
  startDRVM: vi.fn(), stopDRVM: vi.fn(), loadVMRestorePoints: vi.fn(), saveRecoveryPlan: vi.fn(),
  failoverGuest: vi.fn(), startGuestFailback: vi.fn(), cutoverGuestFailback: vi.fn(), cancelGuestFailback: vi.fn(),
}))

vi.mock('@/lib/site-recovery/emergencyActions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/site-recovery/emergencyActions')>()

  emergency.actual = actual

  return {
    ...actual,
    startDRVM: emergency.startDRVM,
    stopDRVM: emergency.stopDRVM,
    loadVMRestorePoints: emergency.loadVMRestorePoints,
    saveRecoveryPlan: emergency.saveRecoveryPlan,
    failoverGuest: emergency.failoverGuest,
    startGuestFailback: emergency.startGuestFailback,
    cutoverGuestFailback: emergency.cutoverGuestFailback,
    cancelGuestFailback: emergency.cancelGuestFailback,
  }
})
vi.mock('swr', async importOriginal => {
  const actual = await importOriginal<typeof import('swr')>()
  return { ...actual, default: (key: string, ...args: unknown[]) => {
    state.swr(key, ...args)
    if (key === '/api/v1/connections?type=pve') return { data: { data: state.connections }, isLoading: false }
    if (key === '/api/v1/vms') return { data: { data: { vms: state.vms } }, mutate: state.mutateVMs }
    if (key?.endsWith('/replication-storages')) return state.discovery[key.split('/')[4]] || { isLoading: true }
    return { mutate: state.mutate }
  } }
})
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: state.pageTitle }) }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: true }), Features: { CEPH_REPLICATION: 'ceph_replication' } }))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/guards/ProviderTenantGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/hooks/useSiteRecovery', () => ({
  useReplicationHealth: () => ({ data: state.health, isLoading: false }),
  useReplicationJobs: () => ({ data: state.jobs, isLoading: state.jobsLoading, mutate: state.mutate }),
  useRecoveryPlans: () => ({ data: state.plans, isLoading: false, mutate: state.mutate }),
  useReplicationJobLogs: () => ({}), useRecoveryHistory: () => ({ mutate: state.mutate }),
}))

// Each stub renders only what a test needs to see of the props the page hands
// it: a prop that stops being passed makes the stub blow up or the text differ.
type EmergencyTabProps = {
  vmStatesByConn: Record<string, Record<number, string>>
  onGuestFailover: (vm: Record<string, unknown>) => void
  onGuestFailback: (vm: Record<string, unknown>) => void
  onStartVM: (vmId: number, targetCluster: string, jobId: string, restorePoint?: string) => Promise<void>
  onStopVM: (vmId: number, targetCluster: string, jobId: string, resumeReplication: boolean) => Promise<void>
  loadRestorePoints: (jobId: string, vmId: number) => Promise<unknown>
}
type PlanDialogProps = {
  open: boolean
  plan: { id: string; name?: string } | null
  jobs: Array<{ id: string }>
  onSubmit: (data: unknown) => void
  onClose: () => void
}
type JobDialogProps = {
  open: boolean
  job: { id: string } | null
  allVMs: Array<{ vmid: number }>
  jobs: Array<{ id: string }>
}

type GuestDialogStubProps = {
  open: boolean
  mode: string
  target: { vmName: string; sourceSite?: string; targetSite?: string } | null
  placements: unknown
  execution: { id: string; status: string } | null
  errorMessage?: string | null
  restorePoints: unknown
  onFailover: (restorePoint?: string) => void
  onStartFailback: () => void
  onCutover: () => void
  onCancelFailback: () => void
  onClose: () => void
}

// One row of the Emergency DR tab: guest 9101 of plan-1, source on src, replica on dst.
const GUEST_ROW = vi.hoisted(() => ({
  vmId: 9101, vmName: 'db', targetVmId: 9101, sourceCluster: 'src', targetCluster: 'dst',
  jobId: 'job-1', planId: 'plan-1', planName: 'Tier 1', siblingCount: 1,
}))

vi.mock('@/components/automation/site-recovery', () => ({
  DashboardTab: ({ onSyncJob }: { onSyncJob: (id: string) => void }) => <div>Dashboard content<button onClick={() => onSyncJob('job')}>Sync job</button></div>,
  ProtectionTab: ({ onResumeJob, onPauseJob, onEditJob }: { onResumeJob: (id: string) => void; onPauseJob: (id: string) => void; onEditJob: (id: string) => void }) => (
    <div>Protection content<button onClick={() => onResumeJob('job')}>Resume job</button><button onClick={() => onPauseJob('job')}>Pause job</button><button onClick={() => onEditJob('job')}>Edit job</button></div>
  ),
  SnapshotsTab: () => <div>Snapshots content</div>,
  GuestFailoverDialog: (props: GuestDialogStubProps) => props.open && props.target ? (
    <div data-testid='guest-dialog'>
      <span data-testid='guest-dialog-head'>{`${props.mode} ${props.target.vmName} ${props.target.sourceSite} -> ${props.target.targetSite}`}</span>
      <span data-testid='guest-dialog-placements'>{JSON.stringify(props.placements)}</span>
      <span data-testid='guest-dialog-execution'>{props.execution ? `${props.execution.id}:${props.execution.status}` : 'none'}</span>
      <span data-testid='guest-dialog-error'>{props.errorMessage || ''}</span>
      <span data-testid='guest-dialog-restore-points'>{JSON.stringify(props.restorePoints)}</span>
      <button onClick={() => props.onFailover('mirror-1')}>Guest dialog failover</button>
      <button onClick={props.onStartFailback}>Guest dialog start failback</button>
      <button onClick={props.onCutover}>Guest dialog cutover</button>
      <button onClick={props.onCancelFailback}>Guest dialog cancel failback</button>
      <button onClick={props.onClose}>Guest dialog close</button>
    </div>
  ) : null,
  RecoveryPlansTab: ({ onEditPlan }: { onEditPlan: (id: string) => void }) => (
    <div>Recovery plans content<button onClick={() => onEditPlan('plan-1')}>Edit plan</button></div>
  ),
  EmergencyDRTab: ({ vmStatesByConn, onStartVM, onStopVM, loadRestorePoints, onGuestFailover, onGuestFailback }: EmergencyTabProps) => (
    <div>Emergency content
      <button onClick={() => onGuestFailover(GUEST_ROW)}>Row failover</button>
      <button onClick={() => onGuestFailback(GUEST_ROW)}>Row failback</button>
      <span data-testid='vm-states'>{JSON.stringify(vmStatesByConn)}</span>
      <button onClick={() => onStartVM(100, 'dst', 'job').catch(state.startError)}>Start DR VM</button>
      <button onClick={() => onStartVM(9101, 'dst', 'job-1', 'mirror-0915').catch(state.startError)}>Start replica from restore point</button>
      <button onClick={() => onStopVM(9101, 'dst', 'job-1', true).catch(state.stopError)}>Stop replica and resume</button>
      <button onClick={() => onStopVM(9101, 'dst', 'job-1', false).catch(state.stopError)}>Stop replica and keep paused</button>
      <button onClick={() => loadRestorePoints('job-1', 9101).then(state.restorePoints, state.restorePointsError)}>Load restore points</button>
    </div>
  ),
  SimulationTab: ({ connections }: { connections: Array<{ hasCeph: boolean }> }) => <div>Simulation: {String(connections.some(connection => connection.hasCeph))}</div>,
  CreateJobDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (data: unknown) => Promise<void> | void }) => (
    <>
      {open ? <div>Create job dialog</div> : null}
      <button onClick={() => Promise.resolve(onSubmit({ name: 'nightly' })).then(state.createOk, state.createError)}>Submit new job</button>
    </>
  ),
  CreatePlanDialog: ({ open, plan, jobs, onSubmit, onClose }: PlanDialogProps) => open ? (
    <div>
      {`Plan dialog for ${plan ? plan.name : 'a new plan'} over ${jobs.length} job(s)`}
      <button onClick={() => onSubmit({ name: 'Nightly tier 1' })}>Submit plan</button>
      <button onClick={onClose}>Close plan dialog</button>
    </div>
  ) : null,
  EditJobDialog: ({ open, job, allVMs, jobs }: JobDialogProps) => open
    ? <div>{`Edit job dialog for ${job ? job.id : 'nothing'} with ${allVMs.length} guest(s) and ${jobs.length} job(s)`}</div>
    : null,
  FailoverDialog: () => null,
}))

import SiteRecoveryPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  state.connections = ['src', 'dst'].map(id => ({ id, name: id, hasCeph: false }))
  state.discovery = {}
  state.jobs = []
  state.plans = []
  state.vms = []
  state.jobsLoading = false

  // A reset clears any leftover one-shot outcome; the request helpers then go
  // back to their real implementation, so a test that says nothing about them
  // still exercises the real one (the 409 tests below rely on it).
  for (const name of ['startDRVM', 'stopDRVM', 'loadVMRestorePoints', 'saveRecoveryPlan'] as const) {
    emergency[name].mockReset()
    emergency[name].mockImplementation(emergency.actual[name])
  }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
const storage = (engines: ReplicationStorages['engines']) => ({ data: { engines, rbd: [], zfs: [] }, isLoading: false })

const CONFLICT = 'A test failover is active. Run cleanup before starting this operation.'
const discovered = () => ({ src: storage([]), dst: storage([]) })

// Two clusters carrying the same VMID, one guest whose state the inventory
// does not know: what the per-connection mapping has to survive.
const inventory = [
  { vmid: '9101', name: 'db-dr', connId: 'dst', status: 'running', node: 'pve-dr-1', type: 'qemu', tags: 'dr; tier1' },
  { vmid: '9101', name: 'db', connId: 'src', status: 'stopped', node: 'pve-1', type: 'qemu' },
  { vmid: '104', name: 'web-dr', connId: 'dst', status: 'stopped', node: 'pve-dr-1', type: 'qemu' },
  { vmid: '9999', name: 'ghost-dr', connId: 'dst', node: 'pve-dr-1', type: 'qemu' },
]

async function openEmergencyTab() {
  state.jobs = [{ id: 'job' }]
  state.discovery = discovered()

  const view = renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('tab', { name: 'Emergency DR' }))

  return view
}

it('enables creation for two ZFS connections without Ceph and keeps Simulation on hasCeph', async () => {
  state.discovery = { src: storage(['zfs']), dst: storage(['zfs']) }
  renderWithProviders(<SiteRecoveryPage />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Replication Job' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Create Replication Job' }))
  expect(screen.getByText('Create job dialog')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Simulation' }))
  expect(screen.getByText('Simulation: false')).toBeInTheDocument()
  expect(state.swr).toHaveBeenCalledWith('/api/v1/connections/src/replication-storages', expect.any(Function), { dedupingInterval: 300_000 })
})

it('does not enable creation for one Ceph and one ZFS connection', async () => {
  state.discovery = { src: storage(['rbd']), dst: storage(['zfs']) }
  renderWithProviders(<SiteRecoveryPage />)
  await screen.findByText('No shared replication engine')
  expect(screen.queryByRole('button', { name: 'Create Replication Job' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Replication' })).toBeDisabled()
})

it('keeps plans and Emergency usable without discovered storage when a plan exists', async () => {
  state.discovery = { src: storage([]), dst: storage([]) }
  state.plans = [{ id: 'plan' }]
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('tab', { name: 'Recovery Plans' }))
  expect(screen.getByText('Recovery plans content')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Emergency DR' }))
  expect(screen.getByText('Emergency content')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create Replication Job' })).toBeDisabled()
})

it('shows a discovery error without locking operations on existing jobs', async () => {
  state.discovery = { src: { error: new Error('offline'), isLoading: false }, dst: storage(['zfs']) }
  state.jobs = [{ id: 'job' }]
  renderWithProviders(<SiteRecoveryPage />)
  await screen.findByText(/Storage discovery failed for a connection/)
  expect(screen.getByRole('tab', { name: 'Recovery Plans' })).toBeEnabled()
  expect(screen.getByRole('tab', { name: 'Emergency DR' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Create Replication Job' })).toBeDisabled()
})

it('waits for both discovery and jobs before initializing the default tab', async () => {
  state.jobsLoading = true
  const view = renderWithProviders(<SiteRecoveryPage />)
  expect(screen.getByText('Discovering replication storage…')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true')
  state.discovery = { src: storage([]), dst: storage([]) }
  view.rerender(<SiteRecoveryPage />)
  await screen.findByText('No replication storage found')
  expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true')
  state.jobsLoading = false
  view.rerender(<SiteRecoveryPage />)
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Simulation' })).toHaveAttribute('aria-selected', 'true'))
})

it.each(['Sync job', 'Resume job'])('surfaces active-test 409 errors for %s', async label => {
  state.jobs = [{ id: 'job' }]
  state.discovery = { src: storage([]), dst: storage([]) }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"test active"}', { status: 409 })))
  renderWithProviders(<SiteRecoveryPage />)
  if (label === 'Resume job') await userEvent.click(screen.getByRole('tab', { name: 'Replication' }))
  await userEvent.click(screen.getByRole('button', { name: label }))
  expect(await screen.findByText('A test failover is active. Run cleanup before starting this operation.')).toBeInTheDocument()
  expect(state.mutate).not.toHaveBeenCalled()
})

it('shows why the orchestrator refused to pause a job instead of saying nothing', async () => {
  state.jobs = [{ id: 'job' }]
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"pause refused by orchestrator"}', { status: 500 }))
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('tab', { name: 'Replication' }))
  await userEvent.click(screen.getByRole('button', { name: 'Pause job' }))
  expect(await screen.findByText('pause refused by orchestrator')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/replication/jobs/job/pause', { method: 'POST' })
  expect(state.mutate).not.toHaveBeenCalled()
})

it('refreshes the jobs after an accepted pause', async () => {
  state.jobs = [{ id: 'job' }]
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"paused"}', { status: 200 })))
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('tab', { name: 'Replication' }))
  await userEvent.click(screen.getByRole('button', { name: 'Pause job' }))
  await waitFor(() => expect(state.mutate).toHaveBeenCalled())
})

it('rejects a job creation the orchestrator refused, so the dialog can keep the form', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"pool not found on target"}', { status: 400 })))
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Submit new job' }))
  await waitFor(() => expect(state.createError).toHaveBeenCalledWith(expect.objectContaining({ message: 'pool not found on target' })))
  expect(state.createOk).not.toHaveBeenCalled()
  expect(state.mutate).not.toHaveBeenCalled()
})

it('creates a job and refreshes the list when the orchestrator accepts it', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"job-2"}', { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Submit new job' }))
  await waitFor(() => expect(state.createOk).toHaveBeenCalled())
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/replication/jobs', expect.objectContaining({ method: 'POST', body: '{"name":"nightly"}' }))
  expect(state.mutate).toHaveBeenCalled()
})

it('passes the active-test cleanup instruction to Emergency start errors', async () => {
  state.jobs = [{ id: 'job' }]
  state.discovery = { src: storage([]), dst: storage([]) }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"test active"}', { status: 409 })))
  renderWithProviders(<SiteRecoveryPage />)
  await userEvent.click(screen.getByRole('tab', { name: 'Emergency DR' }))
  await userEvent.click(screen.getByRole('button', { name: 'Start DR VM' }))
  await waitFor(() => expect(state.startError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A test failover is active. Run cleanup before starting this operation.' })))
})

// ── Per-VM emergency actions ──────────────────────────────────────────

it('hands the Emergency DR rows the replica power states keyed per connection', async () => {
  state.vms = inventory
  await openEmergencyTab()

  // The same VMID lives on both clusters with a different state, and the
  // guest the inventory has no state for is left out rather than guessed.
  expect(JSON.parse(screen.getByTestId('vm-states').textContent ?? '')).toEqual({
    dst: { 104: 'stopped', 9101: 'running' },
    src: { 9101: 'stopped' },
  })
})

it('starts a replica with its guest, its cluster, its job and the chosen restore point, then refreshes the lists', async () => {
  emergency.startDRVM.mockResolvedValueOnce(undefined)
  await openEmergencyTab()
  await userEvent.click(screen.getByRole('button', { name: 'Start replica from restore point' }))

  await waitFor(() => expect(emergency.startDRVM).toHaveBeenCalledWith({
    vmId: 9101, targetCluster: 'dst', jobId: 'job-1', restorePoint: 'mirror-0915', conflictMessage: CONFLICT,
  }))
  await waitFor(() => expect(state.mutateVMs).toHaveBeenCalled())
  expect(state.mutate).toHaveBeenCalled()
  expect(state.startError).not.toHaveBeenCalled()
})

it('lets a refused start reach the tab instead of swallowing it, and refreshes nothing', async () => {
  emergency.startDRVM.mockRejectedValueOnce(new Error('replica image is locked'))
  await openEmergencyTab()
  await userEvent.click(screen.getByRole('button', { name: 'Start replica from restore point' }))

  await waitFor(() => expect(state.startError).toHaveBeenCalledWith(expect.objectContaining({ message: 'replica image is locked' })))
  expect(state.mutateVMs).not.toHaveBeenCalled()
})

it('keeps looking at the jobs and the inventory for a minute after an action, and drops the timers on unmount', async () => {
  emergency.startDRVM.mockResolvedValue(undefined)

  const view = await openEmergencyTab()

  // Fake timers only from the action on: user-event drives its own real ones
  // to reach the tab, and the burst is the only schedule worth controlling.
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Start replica from restore point' }))
  await act(async () => {})
  expect(state.mutateVMs).toHaveBeenCalledTimes(1)

  // 3s and 8s into the burst: the replica's power state, then its job.
  await act(async () => { vi.advanceTimersByTime(10_000) })
  expect(state.mutateVMs).toHaveBeenCalledTimes(3)

  view.unmount()
  await act(async () => { vi.advanceTimersByTime(60_000) })
  expect(state.mutateVMs).toHaveBeenCalledTimes(3)
})

it('passes the resume-replication choice through when a replica is stopped', async () => {
  emergency.stopDRVM.mockResolvedValue(undefined)
  await openEmergencyTab()

  await userEvent.click(screen.getByRole('button', { name: 'Stop replica and resume' }))
  await waitFor(() => expect(emergency.stopDRVM).toHaveBeenCalledWith({
    vmId: 9101, targetCluster: 'dst', jobId: 'job-1', resumeReplication: true, conflictMessage: CONFLICT,
  }))

  await userEvent.click(screen.getByRole('button', { name: 'Stop replica and keep paused' }))
  await waitFor(() => expect(emergency.stopDRVM).toHaveBeenLastCalledWith(expect.objectContaining({ resumeReplication: false })))
  expect(state.stopError).not.toHaveBeenCalled()
})

it('asks for the restore points of one guest, on that guest own job', async () => {
  emergency.loadVMRestorePoints.mockResolvedValueOnce({ restore_points: [{ name: 'mirror-0915' }] })
  await openEmergencyTab()
  await userEvent.click(screen.getByRole('button', { name: 'Load restore points' }))

  await waitFor(() => expect(state.restorePoints).toHaveBeenCalledWith({ restore_points: [{ name: 'mirror-0915' }] }))
  expect(emergency.loadVMRestorePoints).toHaveBeenCalledWith('job-1', 9101)
  expect(state.restorePointsError).not.toHaveBeenCalled()
})

// ── One plan form for creating and for editing ────────────────────────

it('creates a plan when none is being edited', async () => {
  state.jobs = [{ id: 'job' }]
  state.plans = [{ id: 'plan-1', name: 'Nightly tier 1' }]
  state.discovery = discovered()
  emergency.saveRecoveryPlan.mockResolvedValue({ error: null })
  renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('button', { name: 'Create Recovery Plan' }))
  expect(screen.getByText('Plan dialog for a new plan over 1 job(s)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Submit plan' }))

  await waitFor(() => expect(emergency.saveRecoveryPlan).toHaveBeenCalledWith({ name: 'Nightly tier 1' }, null))
  await waitFor(() => expect(state.mutate).toHaveBeenCalled())

  // Creating leaves the form up; its own close is what puts it away.
  await userEvent.click(screen.getByRole('button', { name: 'Close plan dialog' }))
  expect(screen.queryByRole('button', { name: 'Submit plan' })).not.toBeInTheDocument()
})

it('closes the form on a save that never reached the orchestrator, rather than leaving it stuck on that plan', async () => {
  state.jobs = [{ id: 'job' }]
  state.plans = [{ id: 'plan-1', name: 'Nightly tier 1' }]
  state.discovery = discovered()
  emergency.saveRecoveryPlan.mockRejectedValueOnce(new Error('orchestrator unreachable'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('tab', { name: 'Recovery Plans' }))
  await userEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
  await userEvent.click(screen.getByRole('button', { name: 'Submit plan' }))

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit plan' })).not.toBeInTheDocument())
  expect(state.mutate).not.toHaveBeenCalled()
})

it('updates the plan the Edit action picked, then forgets it', async () => {
  state.jobs = [{ id: 'job' }]
  state.plans = [{ id: 'plan-1', name: 'Nightly tier 1' }]
  state.discovery = discovered()
  emergency.saveRecoveryPlan.mockResolvedValue({ error: null })
  renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('tab', { name: 'Recovery Plans' }))
  expect(screen.queryByRole('button', { name: 'Submit plan' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit plan' }))

  // The same form, opened on that plan rather than on an empty one.
  expect(await screen.findByText('Plan dialog for Nightly tier 1 over 1 job(s)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Submit plan' }))

  await waitFor(() => expect(emergency.saveRecoveryPlan).toHaveBeenCalledWith({ name: 'Nightly tier 1' }, 'plan-1'))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit plan' })).not.toBeInTheDocument())
})

it('surfaces the orchestrator refusal of a plan save instead of closing on silence', async () => {
  state.jobs = [{ id: 'job' }]
  state.plans = [{ id: 'plan-1', name: 'Nightly tier 1' }]
  state.discovery = discovered()
  emergency.saveRecoveryPlan.mockResolvedValue({ error: 'plan is failing back' })
  renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('tab', { name: 'Recovery Plans' }))
  await userEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
  await userEvent.click(screen.getByRole('button', { name: 'Submit plan' }))

  expect(await screen.findByText('plan is failing back')).toBeInTheDocument()
  expect(state.mutate).not.toHaveBeenCalled()
})

it('opens the job dialog on the job the Protection tab picked, with the inventory it needs', async () => {
  state.jobs = [{ id: 'job' }]
  state.vms = inventory
  state.discovery = discovered()
  renderWithProviders(<SiteRecoveryPage />)

  await userEvent.click(screen.getByRole('tab', { name: 'Replication' }))
  expect(screen.queryByText(/Edit job dialog/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit job' }))

  expect(await screen.findByText('Edit job dialog for job with 4 guest(s) and 1 job(s)')).toBeInTheDocument()
})

// ── Per-guest failover and failback (ui#943) ─────────────────────────

function stubExecutionFetch(...answers: Array<{ id: string; status: string } | null>) {
  const fetchMock = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift() : answers[0]

    return { ok: next !== null, json: async () => next }
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

async function openGuestRow(button: 'Row failover' | 'Row failback') {
  state.vms = inventory
  state.connections = [{ id: 'src', name: 'PVE-PROD', hasCeph: false }, { id: 'dst', name: 'PVE-DR', hasCeph: false }]
  await openEmergencyTab()
  await userEvent.click(screen.getByRole('button', { name: button }))

  return screen.getByTestId('guest-dialog')
}

it('opens the guest failover on the row, with both sites, where each side runs, and its restore points', async () => {
  emergency.loadVMRestorePoints.mockResolvedValue({ vm_id: 9101, points: [] })
  state.plans = [{ id: 'plan-1', name: 'Tier 1' }]

  await openGuestRow('Row failover')

  expect(screen.getByTestId('guest-dialog-head').textContent).toBe('failover db PVE-PROD -> PVE-DR')
  expect(JSON.parse(screen.getByTestId('guest-dialog-placements').textContent || 'null')).toEqual({
    source: { node: 'pve-1', status: 'stopped' },
    dr: { node: 'pve-dr-1', status: 'running' },
  })
  expect(emergency.loadVMRestorePoints).toHaveBeenCalledWith('job-1', 9101)
  await waitFor(() => expect(screen.getByTestId('guest-dialog-restore-points').textContent).toContain('"loading":false'))
})

it('fails the guest over with the chosen restore point, then follows its execution to the end', async () => {
  emergency.loadVMRestorePoints.mockResolvedValue(null)
  emergency.failoverGuest.mockResolvedValue({ id: 'exec-1', status: 'running' })
  const fetchMock = stubExecutionFetch({ id: 'exec-1', status: 'completed' })

  await openGuestRow('Row failover')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog failover' }))

  expect(emergency.failoverGuest).toHaveBeenCalledWith('plan-1', 9101, 'mirror-1')
  await waitFor(() => expect(screen.getByTestId('guest-dialog-execution').textContent).toBe('exec-1:running'))
  await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
  await waitFor(() => expect(screen.getByTestId('guest-dialog-execution').textContent).toBe('exec-1:completed'))
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/replication/executions/exec-1')
  expect(state.mutate).toHaveBeenCalled()
})

it('shows the refusal of a guest action in the dialog', async () => {
  emergency.loadVMRestorePoints.mockResolvedValue(null)
  emergency.failoverGuest.mockRejectedValue(new Error('this guest is failed over'))

  await openGuestRow('Row failover')
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog failover' }))

  await waitFor(() => expect(screen.getByTestId('guest-dialog-error').textContent).toBe('this guest is failed over'))
  expect(screen.getByTestId('guest-dialog-execution').textContent).toBe('none')
})

it('rehydrates a failback already in flight, cuts it over and refreshes its execution at once', async () => {
  state.plans = [{ id: 'plan-1', name: 'Tier 1', guests: [{ vm_id: 9101, state: 'failing_back', execution_id: 'exec-fb' }] } as { id: string; name?: string }]
  emergency.cutoverGuestFailback.mockResolvedValue({})
  stubExecutionFetch({ id: 'exec-fb', status: 'running' })

  await openGuestRow('Row failback')

  expect(screen.getByTestId('guest-dialog-head').textContent).toBe('failback db PVE-PROD -> PVE-DR')
  await waitFor(() => expect(screen.getByTestId('guest-dialog-execution').textContent).toBe('exec-fb:running'))
  expect(emergency.loadVMRestorePoints).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog cutover' }))

  expect(emergency.cutoverGuestFailback).toHaveBeenCalledWith('plan-1', 9101)
})

it('starts the guest failback, and its cancel closes the dialog', async () => {
  emergency.startGuestFailback.mockResolvedValue({ id: 'exec-2', status: 'running' })
  emergency.cancelGuestFailback.mockResolvedValue({})
  stubExecutionFetch({ id: 'exec-2', status: 'running' })

  await openGuestRow('Row failback')
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog start failback' }))

  expect(emergency.startGuestFailback).toHaveBeenCalledWith('plan-1', 9101)
  await waitFor(() => expect(screen.getByTestId('guest-dialog-execution').textContent).toBe('exec-2:running'))

  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog cancel failback' }))

  expect(emergency.cancelGuestFailback).toHaveBeenCalledWith('plan-1', 9101)
  await waitFor(() => expect(screen.queryByTestId('guest-dialog')).toBeNull())
})

it('closes the guest dialog and refreshes the plans', async () => {
  emergency.loadVMRestorePoints.mockRejectedValue(new Error('down'))

  await openGuestRow('Row failover')
  await waitFor(() => expect(screen.getByTestId('guest-dialog-restore-points').textContent).toContain('"failed":true'))
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog close' }))

  expect(screen.queryByTestId('guest-dialog')).toBeNull()
  expect(state.mutate).toHaveBeenCalled()
})

it('never fills a reopened guest dialog with the restore points of the dialog closed before (roadmap#184)', async () => {
  let releaseFirst!: (v: unknown) => void
  emergency.loadVMRestorePoints
    .mockImplementationOnce(() => new Promise(r => { releaseFirst = r }))
    .mockResolvedValueOnce({ vm_id: 9101, restore_points: [{ snapshot: 'second-open' }] })

  await openGuestRow('Row failover')
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog close' }))
  await userEvent.click(screen.getByRole('button', { name: 'Row failover' }))
  await waitFor(() => expect(screen.getByTestId('guest-dialog-restore-points').textContent).toContain('second-open'))

  await act(async () => { releaseFirst({ vm_id: 9101, restore_points: [{ snapshot: 'first-open' }] }) })
  expect(screen.getByTestId('guest-dialog-restore-points').textContent).toContain('second-open')
  expect(screen.getByTestId('guest-dialog-restore-points').textContent).not.toContain('first-open')
})

it('keeps the outcome of a guest action out of a dialog reopened meanwhile (roadmap#184)', async () => {
  emergency.loadVMRestorePoints.mockResolvedValue(null)
  let refuse!: (e: Error) => void
  emergency.failoverGuest.mockImplementationOnce(() => new Promise((_r, rej) => { refuse = rej }))

  await openGuestRow('Row failover')
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog failover' }))
  await userEvent.click(screen.getByRole('button', { name: 'Guest dialog close' }))
  await userEvent.click(screen.getByRole('button', { name: 'Row failover' }))

  await act(async () => { refuse(new Error('refused for the closed dialog')) })
  expect(screen.getByTestId('guest-dialog-error').textContent).toBe('')
  // The plans are still refreshed: the action did reach the orchestrator.
  expect(state.mutate).toHaveBeenCalled()
})
