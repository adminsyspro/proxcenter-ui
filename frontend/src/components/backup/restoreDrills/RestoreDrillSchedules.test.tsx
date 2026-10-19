import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import RestoreDrillSchedules, { recurrenceText } from './RestoreDrillSchedules'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const swr = vi.hoisted(() => ({
  list: { data: undefined as any, error: undefined as any, isLoading: false },
  mutate: vi.fn(),
  detail: vi.fn(),
  listOpts: vi.fn(),
  listUrl: vi.fn(),
}))
vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (url: string, opts?: unknown) => {
    if (url.startsWith('/api/v1/backups/restore-drills/schedules?')) {
      swr.listUrl(url)
      swr.listOpts(opts)
      return { ...swr.list, mutate: swr.mutate }
    }
    return { data: swr.detail(url, opts), mutate: vi.fn() }
  },
}))

const SOURCE = { pbs_id: 'pbs-1', pbs_name: 'PBS lab', pbs_storage: 'pbs-prod', datastore: 'store1', namespace: 'prod' }
const NIGHTLY = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Nightly web', enabled: true,
  scope: { mode: 'vms', vmids: [100, 101] }, restore_point: 'latest_verified', source: SOURCE,
  connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'bridge', bridge: 'vmbr9',
  calendar: '02:00', vms_per_run: 1, created_by: 'admin@lab', rotation_last_vmid: 100,
  next_run_at: '2026-10-19T02:00:00Z',
  last_run: { id: 'r1', schedule_id: 'x', started_at: '2026-10-18T02:00:00Z', state: 'done', result: 'warning', summary: '1 started without agent', drill_ids: ['d1'], skipped_vmids: [] },
  created_at: '', updated_at: '',
}
const WEEKLY = {
  ...NIGHTLY, id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Weekly all', enabled: false,
  scope: { mode: 'all', vmids: [] }, calendar: 'mon,wed 03:00', next_run_at: '', last_run: null, rotation_last_vmid: 0,
  network_mode: 'link_down', bridge: '', source: { ...SOURCE, namespace: '' },
}
const RAW = { ...WEEKLY, id: 'cccccccc-0000-4000-8000-000000000003', name: 'Every quarter hour', enabled: true, calendar: '*/15', next_run_at: '' }

let calls: Array<{ method: string; url: string; body: any }>

beforeEach(() => {
  swr.list = { data: { data: [NIGHTLY, WEEKLY, RAW], total: 3 }, error: undefined, isLoading: false }
  swr.mutate.mockReset()
  swr.detail.mockReset()
  swr.listOpts.mockReset()
  swr.listUrl.mockReset()
  swr.detail.mockReturnValue({
    schedule: NIGHTLY,
    runs: [
      { id: 'r2', schedule_id: NIGHTLY.id, started_at: '2026-10-18T02:00:00Z', state: 'done', result: 'failed', summary: '1 drill failed', drill_ids: ['d1', 'd2'], skipped_vmids: [{ vmid: 101, reason: 'no verified backup' }] },
      { id: 'r3', schedule_id: NIGHTLY.id, started_at: '2026-10-17T02:00:00Z', state: 'skipped', result: 'skipped', summary: 'previous pass still running', drill_ids: [], skipped_vmids: [] },
    ],
    events: [{ ts: '2026-10-18T02:00:00Z', level: 'warning', stage: '', message: 'missed pass(es) while the orchestrator was down' }],
  })
  toast.success.mockReset()
  toast.error.mockReset()
  calls = []
  server.use(
    http.all('*/api/v1/backups/restore-drills/schedules/:id/run', async ({ request }) => {
      calls.push({ method: request.method, url: request.url, body: null })
      return HttpResponse.json({ run: { id: 'r9' } }, { status: 202 })
    }),
    http.all('*/api/v1/backups/restore-drills/schedules/:id', async ({ request }) => {
      const body = request.method === 'PUT' ? await request.json() : null
      calls.push({ method: request.method, url: request.url, body })
      if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 })
      return HttpResponse.json({ schedule: NIGHTLY })
    }),
  )
})

afterEach(() => cleanup())

const row = (id: string) => screen.getByTestId(`schedule-row-${id}`)

function render(props: Partial<Parameters<typeof RestoreDrillSchedules>[0]> = {}) {
  const onShowDrills = vi.fn()
  const onDrillsChanged = vi.fn()
  renderWithProviders(
    <RestoreDrillSchedules
      pveConnections={[{ id: 'c1', name: 'PVE-PROD' }]}
      pbsConnections={[{ id: 'pbs-1', name: 'PBS lab' }]}
      canRestore
      onShowDrills={onShowDrills}
      onDrillsChanged={onDrillsChanged}
      {...props}
    />,
  )
  return { onShowDrills, onDrillsChanged }
}

describe('RestoreDrillSchedules', () => {
  it('renders one line per schedule: scope, recurrence, next run and last pass', () => {
    render()
    expect(screen.getByText('3 schedules')).toBeInTheDocument()
    const nightly = within(row(NIGHTLY.id))
    expect(nightly.getByText('Nightly web')).toBeInTheDocument()
    expect(nightly.getByText('2 VMs')).toBeInTheDocument()
    expect(nightly.getByText('Daily at 02:00')).toBeInTheDocument()
    expect(nightly.getByText('Warning')).toBeInTheDocument()
    expect(nightly.getByLabelText('Enabled')).toBeInTheDocument()
    const weekly = within(row(WEEKLY.id))
    expect(weekly.getByText('All VMs of PBS lab / store1')).toBeInTheDocument()
    expect(weekly.getByText('Every Monday, Wednesday at 03:00')).toBeInTheDocument()
    expect(weekly.getByText('Disabled')).toBeInTheDocument()
    expect(weekly.getByText('Never')).toBeInTheDocument()
    const raw = within(row(RAW.id))
    expect(raw.getByText('Every 15 minutes')).toBeInTheDocument()
    expect(raw.getByText('-')).toBeInTheDocument()
  })

  it('pages through the server and polls by the drills on screen', () => {
    swr.list = { data: { data: [NIGHTLY], total: 45 }, error: undefined, isLoading: false }
    render({ drills: [{ status: 'running', cleanup_state: 'none' } as any] })
    expect(swr.listUrl).toHaveBeenLastCalledWith('/api/v1/backups/restore-drills/schedules?limit=20&offset=0')
    expect(swr.listOpts).toHaveBeenLastCalledWith({ refreshInterval: 5000, keepPreviousData: true })
    expect(screen.getByText('1-20 of 45')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('restore-drill-schedules-pagination')).getByRole('button', { name: /next page/i }))
    expect(swr.listUrl).toHaveBeenLastCalledWith('/api/v1/backups/restore-drills/schedules?limit=20&offset=20')
    cleanup()
    swr.list = { data: { data: [WEEKLY], total: 1 }, error: undefined, isLoading: false }
    render({ drills: [] })
    expect(swr.listOpts).toHaveBeenLastCalledWith({ refreshInterval: 30000, keepPreviousData: true })
    expect(screen.queryByTestId('restore-drill-schedules-pagination')).toBeNull()
  })

  it('flips a schedule with a PUT of its whole settings', async () => {
    render()
    fireEvent.click(within(row(WEEKLY.id)).getByRole('checkbox', { name: 'Enable or disable' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toMatch(new RegExp(`/schedules/${WEEKLY.id}$`))
    expect(calls[0].body).toEqual({
      name: 'Weekly all', enabled: true, scope: { mode: 'all', vmids: [] }, restore_point: 'latest_verified',
      source: { pbs_id: 'pbs-1', datastore: 'store1', namespace: '' }, connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm',
      network_mode: 'link_down', bridge: '', calendar: 'mon,wed 03:00', vms_per_run: 1,
    })
    await waitFor(() => expect(swr.mutate).toHaveBeenCalled())
  })

  it('reports a refused flip', async () => {
    server.use(http.put('*/api/v1/backups/restore-drills/schedules/:id', () => HttpResponse.json({ error: 'unsupported calendar expression' }, { status: 400 })))
    render()
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('checkbox', { name: 'Enable or disable' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Action failed: unsupported calendar expression'))
  })

  it('runs a pass now and refreshes the history', async () => {
    const { onDrillsChanged } = render()
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pass started'))
    expect(calls[0]).toMatchObject({ method: 'POST' })
    expect(calls[0].url).toMatch(new RegExp(`/schedules/${NIGHTLY.id}/run$`))
    expect(onDrillsChanged).toHaveBeenCalled()
  })

  it('reports a run that cannot reach the server', async () => {
    server.use(http.post('*/api/v1/backups/restore-drills/schedules/:id/run', () => HttpResponse.error()))
    render()
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls[0][0]).toMatch(/^Action failed: /)
  })

  it('deletes after a themed confirmation', async () => {
    render()
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('button', { name: 'Delete' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Delete the schedule Nightly web? Its drills stay in the history.')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Schedule deleted'))
    expect(calls[0]).toMatchObject({ method: 'DELETE' })
    expect(swr.mutate).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the confirmation open with the error, and cancels', async () => {
    server.use(http.delete('*/api/v1/backups/restore-drills/schedules/:id', () => HttpResponse.json({ error: 'schedule not found' }, { status: 404 })))
    render()
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('button', { name: 'Delete' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }))
    expect(await dialog.findByText('Action failed: schedule not found')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('hides every change without backup.restore', () => {
    render({ canRestore: false })
    expect(screen.queryByRole('button', { name: 'New schedule' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(within(row(NIGHTLY.id)).getByRole('checkbox', { name: 'Enable or disable' })).toBeDisabled()
  })

  it('opens the modal for a new schedule and for an edit', async () => {
    server.use(
      http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({})),
      http.get('*/api/v1/pbs/pbs-1/datastores', () => HttpResponse.json({ data: [] })),
    )
    render()
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }))
    expect(await screen.findByText('New restore drill schedule')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(within(row(NIGHTLY.id)).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit schedule Nightly web')).toBeInTheDocument()
  })

  it('shows the details, the last passes with skipped VMs, the events, and filters the history', () => {
    const { onShowDrills } = render()
    fireEvent.click(within(row(NIGHTLY.id)).getByText('Nightly web'))
    const detail = within(row(NIGHTLY.id))
    expect(detail.getByText('PBS lab / store1 / prod')).toBeInTheDocument()
    expect(detail.getByText('100, 101')).toBeInTheDocument()
    expect(detail.getByText('Latest verified backup')).toBeInTheDocument()
    expect(detail.getByText('PVE-PROD / pve1 / local-lvm')).toBeInTheDocument()
    expect(detail.getByText('Isolated bridge (vmbr9)')).toBeInTheDocument()
    expect(detail.getByText('After VM 100')).toBeInTheDocument()
    expect(detail.getByText('admin@lab')).toBeInTheDocument()
    const runs = within(detail.getByTestId('schedule-runs'))
    expect(runs.getByText('Failed')).toBeInTheDocument()
    expect(runs.getByText('2 drills')).toBeInTheDocument()
    expect(runs.getByText('Skipped VMs: VM 101: no verified backup')).toBeInTheDocument()
    expect(runs.getByText('previous pass still running')).toBeInTheDocument()
    expect(detail.getByTestId('schedule-events')).toHaveTextContent('missed pass(es) while the orchestrator was down')
    expect(swr.detail).toHaveBeenCalledWith(`/api/v1/backups/restore-drills/schedules/${NIGHTLY.id}`, { refreshInterval: 0 })
    fireEvent.click(detail.getByRole('button', { name: 'Show its drills' }))
    expect(onShowDrills).toHaveBeenCalledWith(NIGHTLY)
  })

  it('details a fresh schedule: no pass, no event, rotation not started, root namespace', () => {
    swr.detail.mockReturnValue(undefined)
    const running = { ...WEEKLY, last_run: { ...NIGHTLY.last_run, state: 'running', result: '' } }
    swr.list = { data: { data: [running], total: 1 }, error: undefined, isLoading: false }
    render()
    expect(within(row(WEEKLY.id)).getByText('Running')).toBeInTheDocument()
    fireEvent.click(within(row(WEEKLY.id)).getByText('Weekly all'))
    const detail = within(row(WEEKLY.id))
    expect(detail.getByText('PBS lab / store1 / Root')).toBeInTheDocument()
    expect(detail.getByText('Not started')).toBeInTheDocument()
    expect(detail.getByText('No pass yet')).toBeInTheDocument()
    expect(detail.getByText('No event recorded')).toBeInTheDocument()
    expect(detail.getByText('Disconnect all NICs (link_down)')).toBeInTheDocument()
    expect(swr.detail).toHaveBeenCalledWith(`/api/v1/backups/restore-drills/schedules/${WEEKLY.id}`, { refreshInterval: 5000 })
  })

  it('shows the empty and error states, and folds', () => {
    swr.list = { data: { data: [], total: 0 }, error: undefined, isLoading: false }
    render()
    expect(screen.getByText(/No schedule yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Schedules/ }))
    expect(screen.getByRole('button', { name: /Schedules/ })).toHaveAttribute('aria-expanded', 'false')
    cleanup()
    swr.list = { data: undefined, error: new Error('API error: 503'), isLoading: false }
    render()
    expect(screen.getByText('Could not load the schedules')).toBeInTheDocument()
  })
})

describe('recurrenceText', () => {
  const t = ((key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ''}`) as any

  it('reads the simple forms and keeps anything else raw', () => {
    expect(recurrenceText('', t)).toBe('-')
    expect(recurrenceText('*-*-05 01:30', t)).toBe('backups.restoreDrills.schedules.recurrence.monthly{"day":5,"time":"01:30"}')
    expect(recurrenceText('mon..fri 03:00', t)).toContain('"days":"backups.restoreDrills.schedules.weekdayLong.mon, backups.restoreDrills.schedules.weekdayLong.tue')
    expect(recurrenceText('daily 04:00', t)).toBe('backups.restoreDrills.schedules.recurrence.daily{"time":"04:00"}')
    expect(recurrenceText('sat 8..18:*/10', t)).toBe('sat 8..18:*/10')
  })

  it('names every form the orchestrator accepts, in the reader language', async () => {
    const { createTranslator } = await import('next-intl')
    const fr = (await import('@/messages/fr.json')).default
    const tr = createTranslator({ locale: 'fr', messages: fr }) as any
    expect(recurrenceText('02:00', tr)).toBe('Tous les jours à 02:00')
    expect(recurrenceText('daily', tr)).toBe('Tous les jours à 00:00')
    expect(recurrenceText('minutely', tr)).toBe('Toutes les minutes')
    expect(recurrenceText('*/15', tr)).toBe('Toutes les 15 minutes')
    expect(recurrenceText('hourly', tr)).toBe('Toutes les heures')
    expect(recurrenceText('mon 03:30', tr)).toBe('Chaque lundi à 03:30')
    expect(recurrenceText('weekly', tr)).toBe('Chaque lundi à 00:00')
    expect(recurrenceText('mon,wed 03:00', tr)).toBe('Chaque lundi, mercredi à 03:00')
    expect(recurrenceText('*-*-05 02:00', tr)).toBe('Le 5 de chaque mois à 02:00')
    expect(recurrenceText('monthly', tr)).toBe('Le 1 de chaque mois à 00:00')
  })
})
