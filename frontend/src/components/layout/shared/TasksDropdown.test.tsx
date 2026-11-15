import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react'

type Task = {
  id: string
  startTime: string
  type: string
  typeLabel: string
  icon: string
  entity: string | null
  node: string
  user: string
  durationSec: number
  connectionId: string
  connectionName: string
}

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  branding: { browserTitle: '' } as { browserTitle: string },
  // `jobs.running` is the only label the tab title reads; everything else can
  // answer with its own key.
  t: (key: string) => (key === 'jobs.running' ? 'Running' : key),
  emptyList: { data: { data: [] as unknown[] } },
  router: { push: (url: string) => { h.pushed.push(url) } },
  pushed: [] as string[],
  rollingUpdates: { activeUpdates: [] as unknown[], openMonitor: () => {} },
  tenant: { currentTenant: { id: 'default' }, loading: false },
  shared: { data: { data: [] as unknown[] } },
  restoreTask: (() => false) as (id: string) => boolean,
}))

// ⚠️ Every mocked hook has to return a STABLE value across renders, the way
// the real ones do. `t` sits in the deps of the notification effect, which
// calls setLastUpdate(new Date()): hand back a fresh `t` on each render and
// the component spins until the worker is killed for running out of memory.
vi.mock('next-intl', () => ({ useTranslations: () => h.t }))
vi.mock('next/link', () => ({ default: ({ children }: { children?: unknown }) => <a>{children as never}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/hooks/useRunningTasks', () => ({ useRunningTasks: () => ({ data: { data: h.tasks }, isLoading: false }) }))
vi.mock('@/hooks/useChanges', () => ({ useRecentChanges: () => h.emptyList }))
vi.mock('@/hooks/useNavbarNotifications', () => ({ useActiveDeployments: () => h.emptyList }))
vi.mock('@/contexts/RollingUpdateContext', () => ({ useRollingUpdates: () => h.rollingUpdates }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => h.tenant }))
vi.mock('@/contexts/BrandingContext', () => ({ useBranding: () => ({ branding: h.branding }) }))
vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => h.shared }))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({ useProxCenterTasks: () => ({ restoreTask: (id: string) => h.restoreTask(id) }) }))

import TasksDropdown from './TasksDropdown'

const shell = (id: string, node: string): Task => ({
  id,
  startTime: new Date().toISOString(),
  type: 'vncshell',
  typeLabel: 'Shell Console',
  icon: 'ri-terminal-box-line',
  entity: null,
  node,
  user: 'root@pam',
  durationSec: 12,
  connectionId: 'conn-1',
  connectionName: 'PVE-PROD',
})

beforeEach(() => {
  h.tasks = []
  h.shared = { data: { data: [] } }
  h.pushed = []
  h.restoreTask = () => false
  h.branding = { browserTitle: '' }
  document.title = 'PROXCENTER'
})

afterEach(cleanup)

describe('TasksDropdown tab title', () => {
  it('leaves the tab title alone when nothing is running', async () => {
    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('PROXCENTER'))
  })

  it('names the job when a single one is running', async () => {
    h.tasks = [{ ...shell('upid:1', 'pve1'), entity: 'pve1' }]

    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ Shell Console (pve1) · PROXCENTER'))
  })

  // The reported bug: PVE keeps a vncshell task open for as long as its
  // console is, and the title used to join them all into
  // "vncshell • vncshell • vncshell".
  it('counts the jobs instead of listing them once there is more than one', async () => {
    h.tasks = [shell('upid:1', 'pve1'), shell('upid:2', 'pve2'), shell('upid:3', 'pve3')]

    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ 3 running · PROXCENTER'))
    expect(document.title).not.toContain('•')
  })

  it('decorates the white-label browser title, not the product name', async () => {
    h.branding = { browserTitle: 'MSP Cloud' }
    h.tasks = [shell('upid:1', 'pve1'), shell('upid:2', 'pve2')]

    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ 2 running · MSP Cloud'))
  })

  // The base title used to be snapshotted at module load, before the
  // white-label title reaches document.title, so unmounting restored
  // "PROXCENTER" over the tenant's own title.
  it('restores the white-label title, not the stock one, when unmounted', async () => {
    h.branding = { browserTitle: 'MSP Cloud' }
    h.tasks = [shell('upid:1', 'pve1')]

    const { unmount } = render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ Shell Console · MSP Cloud'))

    unmount()

    expect(document.title).toBe('MSP Cloud')
  })

  // Both stop the blink and re-assert the title; neither may leave a stale or
  // doubly decorated one behind.
  it('re-asserts the title when the window regains focus', async () => {
    h.tasks = [shell('upid:1', 'pve1'), shell('upid:2', 'pve2')]

    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ 2 running · PROXCENTER'))

    document.title = 'something else wrote here'
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(document.title).toBe('⏳ 2 running · PROXCENTER')
  })

  it('re-asserts the title when the menu is opened', async () => {
    h.tasks = [shell('upid:1', 'pve1')]

    const { container } = render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ Shell Console · PROXCENTER'))

    document.title = 'something else wrote here'

    const button = container.querySelector('button')

    expect(button).not.toBeNull()
    fireEvent.click(button as HTMLElement)

    expect(document.title).toBe('⏳ Shell Console · PROXCENTER')
  })

  it('does not stack a second marker when it remounts while a job runs', async () => {
    h.tasks = [shell('upid:1', 'pve1'), shell('upid:2', 'pve2')]

    const first = render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ 2 running · PROXCENTER'))

    // A remount reads document.title back as its base title; without the
    // decoration being stripped it would read "⏳ 2 running · ⏳ 2 running · …".
    first.unmount()
    document.title = '⏳ 2 running · PROXCENTER'
    render(<TasksDropdown />)

    await waitFor(() => expect(document.title).toBe('⏳ 2 running · PROXCENTER'))
  })
})

const migration = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'migration', label: `${id} (vCenter -> Proxmox)`, sourceVmName: id, sourceConnectionId: 'vc1', sourceVmId: `vm-${id}`, batchId: null, targetNode: 'pve1', targetVmid: null,
  status: 'full_copy', currentStep: 'full_copy', progress: 40, totalDisks: 1, currentDisk: 0, bytesTransferred: null, totalBytes: null,
  transferSpeed: null, error: null, projectedDowntimeSec: null, cutoverMode: 'auto', convertGuest: true, isMine: true,
  createdByName: 'test', createdAt: new Date().toISOString(), startedAt: null, completedAt: null, ...over,
})

describe('TasksDropdown migrations', () => {
  const open = (container: HTMLElement) => fireEvent.click(container.querySelector('button') as HTMLElement)

  it('lists the migrations under way in their own section and counts them on the button', async () => {
    h.shared = { data: { data: [migration('db-01'), migration('old', { status: 'completed', progress: 100 })] } }

    const { container, getByTestId, queryByText, findAllByTestId } = render(<TasksDropdown />)
    open(container)

    const rows = await findAllByTestId('tasks-dropdown-migration')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('db-01')
    expect(rows[0]).toHaveTextContent('tasks.steps.full_copy')
    expect(rows[0]).toHaveTextContent('40%')
    expect(getByTestId('tasks-dropdown-migrations')).toHaveTextContent('notifications.migrations')
    // the empty state is for a menu with nothing at all under way
    expect(queryByText('common.noData')).toBeNull()
    expect(container.querySelector('.MuiBadge-badge')).toHaveTextContent('1')
  })

  it('says a manual warm migration waits for its cutover rather than syncing', async () => {
    h.shared = { data: { data: [migration('web', { status: 'delta_sync', currentStep: 'delta_7', progress: 90, cutoverMode: 'manual', projectedDowntimeSec: 112 })] } }

    const { container, findByTestId } = render(<TasksDropdown />)
    open(container)

    expect(await findByTestId('tasks-dropdown-migration')).toHaveTextContent('tasks.shared.waitingForCutover')
  })

  it('opens the migrate dialog of the run on its source host, like the task bar', async () => {
    h.shared = { data: { data: [migration('db-01')] } }

    const { container, findByTestId } = render(<TasksDropdown />)
    open(container)
    fireEvent.click(await findByTestId('tasks-dropdown-migration'))

    expect(h.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=db-01'])
  })

  it('opens the follow-up of its batch for a run of a bulk migration', async () => {
    h.shared = { data: { data: [migration('db-02', { batchId: 'b-1' })] } }

    const { container, findByTestId } = render(<TasksDropdown />)
    open(container)
    fireEvent.click(await findByTestId('tasks-dropdown-migration'))

    expect(h.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc1&openBatch=b-1'])
  })

  it('reopens the migrate dialog that started the run when this tab still holds it, like the task bar', async () => {
    const restored: string[] = []
    h.restoreTask = id => { restored.push(id); return true }
    h.shared = { data: { data: [migration('db-01')] } }

    const { container, findByTestId } = render(<TasksDropdown />)
    open(container)
    fireEvent.click(await findByTestId('tasks-dropdown-migration'))

    expect(restored).toEqual(['migration-db-01'])
    expect(h.pushed).toEqual([])
  })

  it('shows five migrations of a big wave, then the rest on demand', async () => {
    h.shared = { data: { data: Array.from({ length: 8 }, (_, i) => migration(`vm-${i}`)) } }

    const { container, findAllByTestId, getByTestId } = render(<TasksDropdown />)
    open(container)

    expect(await findAllByTestId('tasks-dropdown-migration')).toHaveLength(5)
    fireEvent.click(getByTestId('tasks-dropdown-migrations-more'))
    expect(await findAllByTestId('tasks-dropdown-migration')).toHaveLength(8)
  })
})
