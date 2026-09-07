import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationStorages } from '@/lib/orchestrator/site-recovery.types'

const state = vi.hoisted(() => ({
  connections: [] as Array<{ id: string; name: string; hasCeph: boolean }>,
  discovery: {} as Record<string, { data?: ReplicationStorages; error?: Error; isLoading?: boolean }>,
  jobs: [] as Array<{ id: string }>, plans: [] as Array<{ id: string }>, jobsLoading: false,
  startError: vi.fn(), health: { engines: ['rbd', 'zfs'] }, mutate: vi.fn(), pageTitle: vi.fn(), swr: vi.fn(),
}))
vi.mock('swr', async importOriginal => {
  const actual = await importOriginal<typeof import('swr')>()
  return { ...actual, default: (key: string, ...args: unknown[]) => {
    state.swr(key, ...args)
    if (key === '/api/v1/connections?type=pve') return { data: { data: state.connections }, isLoading: false }
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
vi.mock('@/components/automation/site-recovery', () => ({
  DashboardTab: ({ onSyncJob }: { onSyncJob: (id: string) => void }) => <div>Dashboard content<button onClick={() => onSyncJob('job')}>Sync job</button></div>, ProtectionTab: ({ onResumeJob }: { onResumeJob: (id: string) => void }) => <div>Protection content<button onClick={() => onResumeJob('job')}>Resume job</button></div>,
  SnapshotsTab: () => <div>Snapshots content</div>, RecoveryPlansTab: () => <div>Recovery plans content</div>,
  EmergencyDRTab: ({ onStartVM }: { onStartVM: (vm: number, cluster: string, job: string) => Promise<void> }) => <div>Emergency content<button onClick={() => onStartVM(100, 'dst', 'job').catch(state.startError)}>Start DR VM</button></div>,
  SimulationTab: ({ connections }: { connections: Array<{ hasCeph: boolean }> }) => <div>Simulation: {String(connections.some(connection => connection.hasCeph))}</div>,
  CreateJobDialog: ({ open }: { open: boolean }) => open ? <div>Create job dialog</div> : null,
  CreatePlanDialog: () => null, EditJobDialog: () => null, FailoverDialog: () => null,
}))

import SiteRecoveryPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  state.connections = ['src', 'dst'].map(id => ({ id, name: id, hasCeph: false }))
  state.discovery = {}
  state.jobs = []
  state.plans = []
  state.jobsLoading = false
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const storage = (engines: ReplicationStorages['engines']) => ({ data: { engines, rbd: [], zfs: [] }, isLoading: false })

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
