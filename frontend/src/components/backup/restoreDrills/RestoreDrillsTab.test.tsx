import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import RestoreDrillsTab from './RestoreDrillsTab'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const rbac = vi.hoisted(() => ({ value: { loading: false, hasPermission: (_p: string) => true } }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => rbac.value }))

const swr = vi.hoisted(() => ({
  list: { data: undefined as any, error: undefined as any, isLoading: false }, mutate: vi.fn(), detail: vi.fn(), listOpts: vi.fn(), listUrl: vi.fn(),
  schedules: undefined as any, scheduleDetail: undefined as any,
}))
vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (url: string, opts?: { refreshInterval?: unknown }) => {
    if (url.startsWith('/api/v1/backups/restore-drills/schedules?')) return { data: swr.schedules, mutate: vi.fn() }
    if (url.startsWith('/api/v1/backups/restore-drills/schedules/')) return { data: swr.scheduleDetail, mutate: vi.fn() }
    if (url.startsWith('/api/v1/backups/restore-drills?')) {
      swr.listUrl(url)
      swr.listOpts(opts)
      return { ...swr.list, mutate: swr.mutate }
    }
    return { data: swr.detail(url, opts), mutate: vi.fn() }
  },
}))

const stage = (key: string, status: string, detail = '') => ({ key, status, started_at: '', ended_at: '', detail })

const FAILED = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  status: 'failed', phase: 'done', result: 'failed', failed_stage: 'guest_started', error: 'guest did not start',
  cleanup_state: 'failed', cleanup_error: 'destroy timed out',
  connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'link_down', bridge: '',
  source: { vm_name: 'web01', backup_id: '101', backup_time: '2026-10-18T02:00:05Z', archive: 'pbs-prod:backup/vm/101/2026-10-18T02:00:05Z', verify_state: 'ok' },
  temp_vmid: 9001, temp_name: 'drill-101-aaaaaaaa', required_bytes: 0,
  stages: [
    stage('application_check', 'not_assessed'),
    stage('archive_found', 'ok'),
    stage('restore_completed', 'ok'),
    stage('guest_started', 'failed', 'timeout after 600s'),
    stage('guest_agent', 'not_assessed'),
  ],
  cancel_requested: false, requested_by: 'admin@lab',
  created_at: '2026-10-18T09:00:00Z', started_at: '2026-10-18T09:00:00Z', finished_at: '2026-10-18T09:12:03Z', cleaned_at: '',
}
const RUNNING = {
  ...FAILED, id: 'bbbbbbbb-0000-4000-8000-000000000002', status: 'running', result: '', failed_stage: '', error: '',
  cleanup_state: 'none', cleanup_error: '', network_mode: 'bridge', bridge: 'vmbr9', finished_at: '',
  source: { ...FAILED.source, vm_name: 'db01', backup_id: '102' },
}
const VERIFIED = {
  ...FAILED, id: 'cccccccc-0000-4000-8000-000000000003', status: 'succeeded', result: 'boot_verified', failed_stage: '', error: '',
  cleanup_state: 'done', cleanup_error: '', cleaned_at: '2026-10-18T09:13:00Z',
  source: { ...FAILED.source, vm_name: 'app01', backup_id: '103' },
}

beforeEach(() => {
  swr.list = { data: { data: [FAILED, RUNNING, VERIFIED], total: 3 }, error: undefined, isLoading: false }
  swr.mutate.mockReset()
  swr.detail.mockReset()
  swr.listOpts.mockReset()
  swr.listUrl.mockReset()
  swr.detail.mockReturnValue({ drill: FAILED, events: [{ ts: '2026-10-18T09:00:01Z', level: 'error', stage: 'guest_started', message: 'boot timeout' }] })
  toast.success.mockReset()
  toast.error.mockReset()
  rbac.value = { loading: false, hasPermission: () => true }
  swr.schedules = { data: [], total: 0 }
  swr.scheduleDetail = undefined
})

afterEach(() => cleanup())

const row = (id: string) => screen.getByTestId(`drill-row-${id}`)

describe('RestoreDrillsTab', () => {
  it('renders one line per drill with its result and cleanup badge', () => {
    renderWithProviders(<RestoreDrillsTab pveConnections={[{ id: 'c1', name: 'PVE-PROD' }]} />)
    expect(screen.getByText('3 drills')).toBeInTheDocument()
    const failed = within(row(FAILED.id))
    expect(failed.getByText('web01')).toBeInTheDocument()
    expect(failed.getByText('PVE-PROD / pve1 / local-lvm')).toBeInTheDocument()
    expect(failed.getByText('Failed: boot')).toBeInTheDocument()
    expect(failed.getByLabelText('Cleanup failed')).toHaveClass('ri-close-circle-fill')
    expect(failed.queryByText('Cleanup failed')).toBeNull()
    expect(failed.getByText('12m 03s')).toBeInTheDocument()
    expect(within(row(VERIFIED.id)).getByText('Boot verified')).toBeInTheDocument()
    expect(within(row(VERIFIED.id)).getByLabelText('Cleaned up')).toHaveClass('ri-checkbox-circle-fill')
    expect(within(row(RUNNING.id)).queryByRole('img', { name: /clean/i })).toBeNull()
    expect(within(row(RUNNING.id)).getByText('Running')).toBeInTheDocument()
  })

  it('polls the list every 5 s from the first answer that holds an active drill, 30 s otherwise', () => {
    renderWithProviders(<RestoreDrillsTab />)
    expect(swr.listOpts).toHaveBeenLastCalledWith({ refreshInterval: 5000, keepPreviousData: true })
    cleanup()
    swr.list = { data: { data: [FAILED, VERIFIED], total: 2 }, error: undefined, isLoading: false }
    renderWithProviders(<RestoreDrillsTab />)
    expect(swr.listOpts).toHaveBeenLastCalledWith({ refreshInterval: 30000, keepPreviousData: true })
  })

  it('pages through the server: the total drives the pager, a page change asks for its offset', () => {
    swr.list = { data: { data: [FAILED, RUNNING, VERIFIED], total: 45 }, error: undefined, isLoading: false }
    renderWithProviders(<RestoreDrillsTab />)
    expect(swr.listUrl).toHaveBeenLastCalledWith('/api/v1/backups/restore-drills?limit=20&offset=0')
    expect(screen.getByText('45 drills')).toBeInTheDocument()
    expect(screen.getByText('1-20 of 45')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('restore-drills-pagination')).getByRole('button', { name: /next page/i }))
    expect(swr.listUrl).toHaveBeenLastCalledWith('/api/v1/backups/restore-drills?limit=20&offset=20')
  })

  it('shows no pager while the history fits on one page', () => {
    renderWithProviders(<RestoreDrillsTab />)
    expect(screen.queryByTestId('restore-drills-pagination')).toBeNull()
  })

  it('offers each action where it applies', () => {
    renderWithProviders(<RestoreDrillsTab />)
    expect(within(row(FAILED.id)).getByRole('button', { name: 'Retry cleanup' })).toBeInTheDocument()
    expect(within(row(FAILED.id)).getByRole('button', { name: 'Export evidence (PDF)' })).toBeInTheDocument()
    expect(within(row(FAILED.id)).queryByRole('button', { name: 'Cancel drill' })).toBeNull()
    expect(within(row(RUNNING.id)).getByRole('button', { name: 'Cancel drill' })).toBeInTheDocument()
    expect(within(row(RUNNING.id)).queryByRole('button', { name: 'Export evidence (PDF)' })).toBeNull()
    expect(within(row(VERIFIED.id)).queryByRole('button', { name: 'Retry cleanup' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Restore drill settings' })).toBeInTheDocument()
  })

  it('hides the cancel, cleanup and settings actions without the rights', () => {
    rbac.value = { loading: false, hasPermission: () => false }
    renderWithProviders(<RestoreDrillsTab />)
    expect(screen.queryByRole('button', { name: 'Retry cleanup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel drill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore drill settings' })).toBeNull()
    expect(within(row(FAILED.id)).getByRole('button', { name: 'Export evidence (PDF)' })).toBeInTheDocument()
  })

  it('expands the stages, with not_assessed spelled out, the error, the test VM and the log', () => {
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(FAILED.id)).getByText('web01'))
    const detail = within(row(FAILED.id))
    expect(detail.getAllByText('Not assessed')).toHaveLength(2)
    expect(detail.getByText('timeout after 600s')).toBeInTheDocument()
    expect(detail.getByText('guest did not start')).toBeInTheDocument()
    expect(detail.getByText('Cleanup failed: destroy timed out')).toBeInTheDocument()
    expect(detail.getByText('VMID 9001, drill-101-aaaaaaaa')).toBeInTheDocument()
    expect(detail.getByTestId('drill-events')).toHaveTextContent('[guest_started] boot timeout')
    expect(swr.detail).toHaveBeenCalledWith(`/api/v1/backups/restore-drills/${FAILED.id}`, { refreshInterval: 0 })
    const labels = detail.getAllByText(/^(Archive found|Restore completed|Guest started|Guest agent|Application check)$/).map(n => n.textContent)
    expect(labels).toEqual(['Archive found', 'Restore completed', 'Guest started', 'Guest agent', 'Application check'])
  })

  it('shows the captured console as a thumbnail that opens full size, with its UTC time', async () => {
    const shot = { ...VERIFIED, screenshot_state: 'captured', screenshot_at: '2026-10-18T09:05:00Z', screenshot_error: '' }
    swr.detail.mockReturnValue({ drill: shot, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    const thumb = within(row(VERIFIED.id)).getByAltText('Screenshot')
    expect(thumb).toHaveAttribute('src', `/api/v1/backups/restore-drills/${VERIFIED.id}/screenshot`)
    fireEvent.mouseOver(thumb)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Captured on 2026-10-18 09:05:00 UTC')
    fireEvent.click(thumb)
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('VMID 9001, drill-101-aaaaaaaa')).toBeInTheDocument()
    expect(dialog.getByText('Captured on 2026-10-18 09:05:00 UTC')).toBeInTheDocument()
    expect(dialog.getByAltText('VMID 9001, drill-101-aaaaaaaa')).toHaveAttribute('src', `/api/v1/backups/restore-drills/${VERIFIED.id}/screenshot`)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('names the screenshot by its title when the drill has no test VM yet', () => {
    swr.detail.mockReturnValue({ drill: { ...VERIFIED, temp_vmid: 0, screenshot_state: 'captured', screenshot_at: '' }, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    fireEvent.click(within(row(VERIFIED.id)).getByAltText('Screenshot'))
    expect(within(screen.getByRole('dialog')).getAllByText('Screenshot').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('dialog')).getByText('Captured on -')).toBeInTheDocument()
  })

  it('shows a started guest without agent as a warning, with the reason, and the screenshot last in the details', () => {
    const started = { ...VERIFIED, result: 'vm_started', screenshot_state: 'unavailable', screenshot_error: 'no SSH' }
    swr.list = { data: { data: [started], total: 1 }, error: undefined, isLoading: false }
    swr.detail.mockReturnValue({ drill: started, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    expect(within(row(VERIFIED.id)).getByText('Started, OS not verified')).toBeInTheDocument()
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    expect(within(row(VERIFIED.id)).getByText(/No guest agent is configured in this VM/)).toBeInTheDocument()
    const text = row(VERIFIED.id).textContent || ''
    expect(text.indexOf('Screenshot unavailable')).toBeGreaterThan(text.lastIndexOf('Cleaned up'))
    expect(text.indexOf('Screenshot unavailable')).toBeLessThan(text.indexOf('Events'))
  })

  it('says why the screenshot is unavailable, and shows nothing before any capture', () => {
    swr.detail.mockReturnValue({ drill: { ...VERIFIED, screenshot_state: 'unavailable', screenshot_error: 'node pve1 unreachable' }, events: [] })
    const { unmount } = renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    expect(within(row(VERIFIED.id)).getByTestId('drill-screenshot-unavailable')).toHaveTextContent('Screenshot unavailable: node pve1 unreachable')
    unmount()

    swr.detail.mockReturnValue({ drill: { ...VERIFIED, screenshot_state: 'unavailable', screenshot_error: '' }, events: [] })
    const second = renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    expect(within(row(VERIFIED.id)).getByTestId('drill-screenshot-unavailable')).toHaveTextContent(/^Screenshot unavailable$/)
    second.unmount()

    swr.detail.mockReturnValue({ drill: { ...FAILED, screenshot_state: '' }, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(FAILED.id)).getByText('web01'))
    expect(within(row(FAILED.id)).queryByText('Screenshot')).not.toBeInTheDocument()
    expect(within(row(FAILED.id)).queryByTestId('drill-screenshot-unavailable')).not.toBeInTheDocument()
  })

  it('polls the detail of an active drill and shows its bridge', () => {
    swr.detail.mockReturnValue(undefined)
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(RUNNING.id)).getByText('db01'))
    expect(swr.detail).toHaveBeenCalledWith(`/api/v1/backups/restore-drills/${RUNNING.id}`, { refreshInterval: 5000 })
    expect(within(row(RUNNING.id)).getByText('Isolated bridge (vmbr9)')).toBeInTheDocument()
    expect(within(row(RUNNING.id)).getByText('No event recorded')).toBeInTheDocument()
  })

  it('retries a cleanup and cancels a running drill', async () => {
    let cleanupCalls = 0
    server.use(
      http.post(`*/api/v1/backups/restore-drills/${FAILED.id}/cleanup`, () => { cleanupCalls++; return HttpResponse.json({ drill: FAILED }, { status: 202 }) }),
      http.post(`*/api/v1/backups/restore-drills/${RUNNING.id}/cancel`, () => HttpResponse.json({ error: 'not active' }, { status: 409 })),
    )
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(FAILED.id)).getByRole('button', { name: 'Retry cleanup' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Cleanup restarted'))
    expect(cleanupCalls).toBe(1)
    fireEvent.click(within(row(RUNNING.id)).getByRole('button', { name: 'Cancel drill' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Action failed: not active'))
    expect(swr.mutate).toHaveBeenCalledTimes(2)
  })

  it('downloads the evidence under the orchestrator file name', async () => {
    server.use(
      http.get(`*/api/v1/backups/restore-drills/${FAILED.id}/evidence`, () => new HttpResponse('{"format":"x"}', {
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="restore-drill-aaaaaaaa-20261018-091203.json"' },
      })),
    )
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(FAILED.id)).getByRole('button', { name: 'Export evidence (PDF)' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('restore-drill-aaaaaaaa-20261018-091203.json')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })

  it('reports a failed export', async () => {
    server.use(http.get(`*/api/v1/backups/restore-drills/${FAILED.id}/evidence`, () => HttpResponse.json({ error: 'drill not found' }, { status: 404 })))
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(within(row(FAILED.id)).getByRole('button', { name: 'Export evidence (PDF)' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Action failed: drill not found'))
  })

  it('shows the empty and error states, and reloads on demand', () => {
    swr.list = { data: { data: [], total: 0 }, error: undefined, isLoading: false }
    const { unmount } = renderWithProviders(<RestoreDrillsTab refreshKey={5} />)
    expect(screen.getByText(/No restore drill yet/)).toBeInTheDocument()
    expect(swr.mutate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(swr.mutate).toHaveBeenCalledTimes(2)
    unmount()
    swr.list = { data: undefined, error: new Error('API error: 500'), isLoading: false }
    renderWithProviders(<RestoreDrillsTab />)
    expect(screen.getByText('Could not load the restore drills')).toBeInTheDocument()
  })

  it('opens the settings dialog from the gear', async () => {
    server.use(http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({ max_concurrent: 2 })))
    renderWithProviders(<RestoreDrillsTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore drill settings' }))
    expect(await screen.findByLabelText('Simultaneous drills')).toHaveValue('2')
  })

  it('names the origin of each drill on its line and in its details', () => {
    const scheduled = { ...VERIFIED, schedule_id: 's1', schedule_name: 'Nightly web', queued_at: '2026-10-18T08:59:00Z' }
    swr.list = { data: { data: [FAILED, scheduled], total: 2 }, error: undefined, isLoading: false }
    swr.detail.mockReturnValue({ drill: scheduled, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    expect(screen.getByText('Origin')).toBeInTheDocument()
    expect(within(row(FAILED.id)).getByTestId('drill-origin')).toHaveTextContent('Manual')
    expect(within(row(VERIFIED.id)).getByTestId('drill-origin')).toHaveTextContent('Nightly web')
    fireEvent.click(within(row(VERIFIED.id)).getByText('app01'))
    const detail = within(row(VERIFIED.id))
    expect(detail.getAllByText('Nightly web')).toHaveLength(2)
    expect(detail.getByText('Queued')).toBeInTheDocument()
  })

  it('shows a queued drill as waiting and cancellable, a refused one as refused with its reason', () => {
    const queued = { ...RUNNING, id: 'dddddddd-0000-4000-8000-000000000004', status: 'queued', temp_vmid: 0, started_at: '', source: { ...RUNNING.source, vm_name: 'q01' } }
    const refused = { ...FAILED, id: 'eeeeeeee-0000-4000-8000-000000000005', status: 'refused', result: 'refused', failed_stage: '', error: 'not enough free space', cleanup_state: 'none', cleanup_error: '', source: { ...FAILED.source, vm_name: 'r01' } }
    swr.list = { data: { data: [queued, refused], total: 2 }, error: undefined, isLoading: false }
    swr.detail.mockReturnValue({ drill: refused, events: [] })
    renderWithProviders(<RestoreDrillsTab />)
    expect(within(row(queued.id)).getByText('Queued')).toBeInTheDocument()
    expect(within(row(queued.id)).getByLabelText('Queued')).toHaveClass('ri-hourglass-line')
    expect(within(row(queued.id)).getByRole('button', { name: 'Cancel drill' })).toBeInTheDocument()
    expect(within(row(refused.id)).getByText('Refused')).toBeInTheDocument()
    expect(within(row(refused.id)).getByLabelText('Refused')).toHaveClass('ri-forbid-line')
    expect(within(row(refused.id)).getByRole('button', { name: 'Export evidence (PDF)' })).toBeInTheDocument()
    fireEvent.click(within(row(refused.id)).getByText('r01'))
    expect(within(row(refused.id)).getByText('not enough free space')).toBeInTheDocument()
  })

  it('filters the history by a schedule from its details, and clears the filter', () => {
    const schedule = {
      id: 'ffffffff-0000-4000-8000-000000000006', name: 'Nightly web', enabled: true, scope: { mode: 'all', vmids: [] },
      restore_point: 'latest', source: { pbs_id: 'p', pbs_name: 'PBS', pbs_storage: 's', datastore: 'd', namespace: '' },
      connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'link_down', bridge: '', calendar: '02:00',
      vms_per_run: 1, created_by: '', rotation_last_vmid: 0, next_run_at: '', last_run: null, created_at: '', updated_at: '',
    }
    swr.schedules = { data: [schedule], total: 1 }
    swr.list = { data: { data: [FAILED], total: 1 }, error: undefined, isLoading: false }
    renderWithProviders(<RestoreDrillsTab pbsConnections={[{ id: 'p', name: 'PBS' }]} />)
    fireEvent.click(within(screen.getByTestId(`schedule-row-${schedule.id}`)).getByText('Nightly web'))
    fireEvent.click(screen.getByRole('button', { name: 'Show its drills' }))
    expect(swr.listUrl).toHaveBeenLastCalledWith(`/api/v1/backups/restore-drills?limit=20&offset=0&schedule_id=${schedule.id}`)
    expect(screen.getByTestId('drills-schedule-filter')).toHaveTextContent('Drills of Nightly web')
    fireEvent.click(screen.getByLabelText('Show all drills'))
    expect(swr.listUrl).toHaveBeenLastCalledWith('/api/v1/backups/restore-drills?limit=20&offset=0')
    expect(screen.queryByTestId('drills-schedule-filter')).toBeNull()
  })
})

describe('spinSx', () => {
  it('spins the in-progress glyph only', async () => {
    const { spinSx } = await import('./shared')
    expect(spinSx('ri-loader-4-line')).toMatchObject({ animation: 'drillSpin 1s linear infinite' })
    expect(spinSx('ri-checkbox-circle-fill')).toEqual({})
  })
})
