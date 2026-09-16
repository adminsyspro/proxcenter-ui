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

vi.mock('@/components/automation/site-recovery', () => ({
  DashboardTab: ({ onSyncJob }: { onSyncJob: (id: string) => void }) => <div>Dashboard content<button onClick={() => onSyncJob('job')}>Sync job</button></div>,
  ProtectionTab: ({ onResumeJob, onEditJob }: { onResumeJob: (id: string) => void; onEditJob: (id: string) => void }) => (
    <div>Protection content<button onClick={() => onResumeJob('job')}>Resume job</button><button onClick={() => onEditJob('job')}>Edit job</button></div>
  ),
  SnapshotsTab: () => <div>Snapshots content</div>,
  RecoveryPlansTab: ({ onEditPlan }: { onEditPlan: (id: string) => void }) => (
    <div>Recovery plans content<button onClick={() => onEditPlan('plan-1')}>Edit plan</button></div>
  ),
  EmergencyDRTab: ({ vmStatesByConn, onStartVM, onStopVM, loadRestorePoints }: EmergencyTabProps) => (
    <div>Emergency content
      <span data-testid='vm-states'>{JSON.stringify(vmStatesByConn)}</span>
      <button onClick={() => onStartVM(100, 'dst', 'job').catch(state.startError)}>Start DR VM</button>
      <button onClick={() => onStartVM(9101, 'dst', 'job-1', 'mirror-0915').catch(state.startError)}>Start replica from restore point</button>
      <button onClick={() => onStopVM(9101, 'dst', 'job-1', true).catch(state.stopError)}>Stop replica and resume</button>
      <button onClick={() => onStopVM(9101, 'dst', 'job-1', false).catch(state.stopError)}>Stop replica and keep paused</button>
      <button onClick={() => loadRestorePoints('job-1', 9101).then(state.restorePoints, state.restorePointsError)}>Load restore points</button>
    </div>
  ),
  SimulationTab: ({ connections }: { connections: Array<{ hasCeph: boolean }> }) => <div>Simulation: {String(connections.some(connection => connection.hasCeph))}</div>,
  CreateJobDialog: ({ open }: { open: boolean }) => open ? <div>Create job dialog</div> : null,
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
