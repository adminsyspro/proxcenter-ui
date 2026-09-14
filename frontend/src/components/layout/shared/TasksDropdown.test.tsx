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
  router: { push: () => {} },
  rollingUpdates: { activeUpdates: [] as unknown[], openMonitor: () => {} },
  tenant: { currentTenant: { id: 'default' }, loading: false },
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
