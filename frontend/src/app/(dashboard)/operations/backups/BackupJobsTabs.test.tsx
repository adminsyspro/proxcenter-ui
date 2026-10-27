import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import BackupJobsTabs from './BackupJobsTabs'

const state = vi.hoisted(() => ({
  tenant: null as { id: string } | null,
  drills: false,
  runs: undefined as unknown,
}))

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: state.tenant, loading: false }),
}))
vi.mock('@/contexts/LicenseContext', () => ({
  Features: { BACKUP_RESTORE_DRILLS: 'backup_restore_drills' },
  useLicense: () => ({ hasFeature: () => state.drills }),
}))
vi.mock('@/components/backup/restoreDrills/RestoreDrillsTab', () => ({
  default: ({ refreshKey }: { refreshKey: number }) => <div data-testid="drills">{refreshKey}</div>,
}))
vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (url: string | null) => ({ data: url ? state.runs : undefined, isLoading: false, error: undefined, mutate: vi.fn() }),
}))
vi.mock('./BackupJobRunsDrawer', () => ({
  default: ({ open, title, subtitle }: { open: boolean; title?: string; subtitle?: string | null }) =>
    open ? <div data-testid="runs-drawer">{title}|{subtitle}</div> : null,
}))
vi.mock('./BackupSchedulePicker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="schedule" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

// The grid is MUI X's virtualized one, which lays out no row under jsdom:
// render every row and cell so the cell renderers run.
interface MockColumn {
  field: string
  valueGetter?: (value: unknown, row: Record<string, unknown>) => unknown
  renderCell?: (params: { value: unknown; row: Record<string, unknown> }) => ReactNode
}
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns, onRowClick, localeText }: {
    rows: Array<Record<string, unknown> & { id: string }>
    columns: MockColumn[]
    onRowClick?: (p: { row: Record<string, unknown> }) => void
    localeText?: { noRowsLabel?: string }
  }) => (
    <table>
      <tbody>
        {rows.length === 0 && <tr><td>{localeText?.noRowsLabel}</td></tr>}
        {rows.map(row => (
          <tr key={row.id} data-testid={`row-${row.id}`} onClick={() => onRowClick?.({ row })}>
            {columns.map(col => {
              const value = col.valueGetter ? col.valueGetter(row[col.field], row) : row[col.field]

              return <td key={col.field}>{col.renderCell ? col.renderCell({ value, row }) : String(value ?? '')}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))

const PVE = [{ id: 'c1', name: 'PVE-PROD' }]
const PBS = [{ id: 'p1', name: 'PBS' }]

const PVE_JOBS = [
  {
    id: 'backup-all', enabled: true, storage: 'pbs1', schedule: '21:00', node: null, mode: 'snapshot', compress: 'zstd',
    selectionMode: 'all', excludedVmids: ['101'], vmids: [], comment: 'nightly', mailto: '', mailnotification: 'always',
    maxfiles: 3, namespace: 'ns1', nextRun: 1790256602,
  },
  { id: 'backup-some', enabled: false, storage: 'pbs1', selectionMode: 'include', vmids: ['100'], mode: 'stop' },
  { id: 'backup-pool', enabled: true, storage: 'pbs1', selectionMode: 'pool', pool: 'prod', mode: 'suspend' },
]

const STORAGES = [
  { id: 'pbs1', name: 'pbs1', type: 'pbs', isPbs: true, namespace: 'ns1', datastore: 'ds1' },
  { id: 'pbs-tenant', name: 'pbs-tenant', type: 'pbs', isPbs: true, namespace: 'tenants/acme', datastore: 'ds1' },
  { id: 'local', name: 'local', type: 'dir', isPbs: false },
]

const PBS_JOBS = [
  { id: 'sync1', type: 'sync', enabled: true, store: 'ds1', ns: 'prod', schedule: 'daily', remote: 'r1', lastRunState: 'OK', lastRunEndtime: '2026-10-01T10:00:00Z', comment: 'mirror' },
  { id: 'prune1', type: 'prune', enabled: false, datastore: 'ds1', keepLast: 5, lastRunState: 'ERROR' },
  { id: 'gc1', type: 'gc', store: 'ds1', lastRunState: 'running' },
  { id: 'verify1', type: 'verify', store: 'ds1', lastRunState: 'WARNING' },
  { id: 'tape1', type: 'tape', store: 'ds1', pool: 'MediaPool', drive: 'drive0', lastRunState: 'queued' },
]

interface Call { method: string; url: string; body: unknown }
let calls: Call[] = []
let saveResponse: Record<string, unknown> = { data: {} }
// "METHOD url-part" entries whose fetch rejects, as on a network failure.
let failing: string[] = []

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response)
}

function routeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const method = init?.method || 'GET'
  calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
  if (failing.some(f => { const [m, part] = f.split(' '); return m === method && url.includes(part) })) {
    return Promise.reject(new Error(`network down: ${method}`))
  }
  if (method === 'GET' && url === '/api/v1/connections/c1/backup-jobs') {
    return jsonResponse({ data: { jobs: PVE_JOBS, allBackupStorages: STORAGES, nodes: [{ node: 'pve1' }] } })
  }
  if (url.startsWith('/api/v1/connections/c1/resources')) {
    return jsonResponse({ data: [{ vmid: 100, name: 'web', type: 'qemu', node: 'pve1', status: 'running' }, { vmid: 1, name: 'n', type: 'node' }] })
  }
  if (url === '/api/v1/connections/c1/pools') return jsonResponse({ data: [{ poolid: 'prod', comment: 'Production' }, { poolid: '' }] })
  if (url === '/api/v1/vdcs') {
    return jsonResponse({ data: [{ id: 'v1', name: 'Acme', connectionId: 'c1', pvePoolName: 'acme-pool', pbsBindings: [{ namespace: '/tenants/acme/', datastore: 'ds1' }] }] })
  }
  if (method === 'GET' && url === '/api/v1/pbs/p1/jobs') {
    return jsonResponse({
      data: {
        jobs: { all: PBS_JOBS, sync: [PBS_JOBS[0]], prune: [PBS_JOBS[1]] },
        datastores: ['ds1', 'ds2'],
        stats: { total: 5, byType: { sync: 1, prune: 1, gc: 1, verify: 1, tape: 1 }, lastRunStates: { ok: 1, error: 1, warning: 1 } },
      },
    })
  }
  if (url.includes('action=run')) return jsonResponse({ data: { tasks: [{ upid: 'UPID:1' }] } })
  if (method === 'POST' || method === 'PUT') return jsonResponse(saveResponse)

  return jsonResponse({ data: {} })
}

beforeEach(() => {
  calls = []
  saveResponse = { data: {} }
  failing = []
  state.tenant = null
  state.drills = false
  state.runs = undefined
  vi.stubGlobal('fetch', vi.fn(routeFetch))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const PVE_FORM_KEYS = [
  'comment', 'compress', 'enabled', 'excludedVmids', 'mailnotification', 'mailto', 'maxfiles', 'mode', 'node', 'pool',
  'schedule', 'selectionMode', 'storage', 'vmids',
].sort()

function lastCall(method: string, urlPart: string) {
  return [...calls].reverse().find(c => c.method === method && c.url.includes(urlPart))
}

async function openPveTab(props: Partial<Parameters<typeof BackupJobsTabs>[0]> = {}) {
  renderWithProviders(<BackupJobsTabs pveConnections={PVE} pbsConnections={PBS} {...props} />)
  fireEvent.click(screen.getByText('Backup jobs'))
  await screen.findByTestId('row-backup-all')
}

describe('BackupJobsTabs, PVE jobs', () => {
  it('creates a job from the Create Job button with only the form fields in the body', async () => {
    await openPveTab()
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(lastCall('POST', '/backup-jobs')).toBeTruthy())
    const post = lastCall('POST', '/backup-jobs')!
    expect(post.url).toBe('/api/v1/connections/c1/backup-jobs')
    expect(Object.keys(post.body as object).sort()).toEqual(PVE_FORM_KEYS)
    expect(post.body).toMatchObject({ storage: 'pbs1', selectionMode: 'all', schedule: '00:00', enabled: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('prefills the guest of a coverage card request', async () => {
    renderWithProviders(<BackupJobsTabs pveConnections={PVE} createRequest={{ connId: 'c1', vmid: 100, nonce: 1 }} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(lastCall('POST', '/backup-jobs')).toBeTruthy())
    expect(lastCall('POST', '/backup-jobs')!.body).toMatchObject({ selectionMode: 'include', vmids: ['100'], storage: 'pbs1' })
  })

  it('shows each selection mode of the listed jobs', async () => {
    await openPveTab()
    expect(within(screen.getByTestId('row-backup-all')).getByText('All except 1')).toBeTruthy()
    expect(within(screen.getByTestId('row-backup-some')).getByText('1 VMs')).toBeTruthy()
    expect(within(screen.getByTestId('row-backup-pool')).getByText('Pool: prod')).toBeTruthy()
  })

  it('saves an edited job with PUT on its id', async () => {
    await openPveTab()
    const row = screen.getByTestId('row-backup-all')
    fireEvent.click(within(row).getAllByRole('button')[1])
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'renamed' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lastCall('PUT', '/backup-jobs/backup-all')).toBeTruthy())
    expect(lastCall('PUT', '/backup-jobs/backup-all')!.body).toMatchObject({ comment: 'renamed', schedule: '21:00', maxfiles: 3, node: '' })
  })

  it('reports a namespace mismatch returned by the save', async () => {
    saveResponse = { error: 'mismatch', code: 'namespace_storage_mismatch', storage: 'pbs1', namespace: 'other' }
    await openPveTab()
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/does not write to namespace "other"/)).toBeTruthy()
  })

  it('toggles, runs and deletes a job', async () => {
    await openPveTab()
    const row = screen.getByTestId('row-backup-all')

    fireEvent.click(within(row).getByRole('switch'))
    await waitFor(() => expect(lastCall('PUT', '/backup-jobs/backup-all')!.body).toEqual({ enabled: false }))

    fireEvent.click(within(row).getAllByRole('button')[0])
    await waitFor(() => expect(lastCall('POST', 'action=run')).toBeTruthy())
    expect((await screen.findByTestId('runs-drawer')).textContent).toContain('backup-all')

    fireEvent.click(within(row).getAllByRole('button')[2])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('nightly')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(lastCall('DELETE', '/backup-jobs/backup-all')).toBeTruthy())
  })

  it('opens the run history of a row and of the manual backups', async () => {
    state.runs = {
      data: {
        jobs: [{ jobId: 'backup-all', pool: null, nextRun: null, runs: [], lastRun: { id: 'r1', start: 1790256602, durationSec: 12, status: 'ok', statusDetail: { failed: 0, total: 1 }, tasks: [] } }],
        manual: { runs: [], lastRun: null },
        unreachableNodes: ['pve2'],
        truncatedNodes: [],
        window: { since: 0, days: 30 },
      },
    }
    await openPveTab()
    expect(screen.getByText(/pve2/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('row-backup-some'))
    expect((await screen.findByTestId('runs-drawer')).textContent).toContain('backup-some')
  })

  it('sends the picked schedule', async () => {
    await openPveTab()
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('schedule'), { target: { value: 'sat 02:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(lastCall('POST', '/backup-jobs')!.body).toMatchObject({ schedule: 'sat 02:00' }))
  })

  it('shows a network failure of each action', async () => {
    failing = ['POST /backup-jobs', 'DELETE /backup-jobs/']
    await openPveTab()
    const row = screen.getByTestId('row-backup-all')

    fireEvent.click(within(row).getAllByRole('button')[0])
    expect(await screen.findByText('network down: POST')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(lastCall('POST', '/api/v1/connections/c1/backup-jobs')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(row).getAllByRole('button')[2])
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('network down: DELETE')).toBeTruthy()
  })

  it('shows a failed job list', async () => {
    failing = ['GET /api/v1/connections/c1/backup-jobs']
    renderWithProviders(<BackupJobsTabs pveConnections={PVE} />)
    fireEvent.click(screen.getByText('Backup jobs'))
    expect(await screen.findByText('network down: GET')).toBeTruthy()
  })

  it('says when no PVE cluster is configured', () => {
    renderWithProviders(<BackupJobsTabs />)
    fireEvent.click(screen.getByText('Backup jobs'))
    expect(screen.getByText(/No PVE cluster configured/)).toBeTruthy()
  })
})

describe('BackupJobsTabs, vDC tenant', () => {
  it('preselects the storage bound to the vDC namespace and its pool', async () => {
    state.tenant = { id: 'acme' }
    await openPveTab()
    await waitFor(() => expect(lastCall('GET', '/api/v1/vdcs')).toBeTruthy())
    // The vDC list resolves after the jobs: let it land before opening the dialog.
    await new Promise(r => setTimeout(r, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(lastCall('POST', '/backup-jobs')).toBeTruthy())
    expect(lastCall('POST', '/backup-jobs')!.body).toMatchObject({ storage: 'pbs-tenant', selectionMode: 'pool', pool: 'acme-pool' })
  })
})

describe('BackupJobsTabs, PBS jobs', () => {
  async function openPbsTab() {
    renderWithProviders(<BackupJobsTabs pveConnections={PVE} pbsConnections={PBS} />)
    fireEvent.click(screen.getByText('Backup jobs'))
    fireEvent.click(screen.getByRole('tab', { name: /PBS/ }))
    await screen.findByTestId('row-sync1')
  }

  it('creates a sync job', async () => {
    await openPbsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Create Sync Job' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Job ID/), { target: { value: 'nightly-sync' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(lastCall('POST', '/api/v1/pbs/p1/jobs/sync')).toBeTruthy())
    expect(lastCall('POST', '/api/v1/pbs/p1/jobs/sync')!.body).toMatchObject({ id: 'nightly-sync', store: 'ds1', schedule: '00:00' })
  })

  it.each([
    ['Create Prune Job', 'prune'],
    ['Create Verify Job', 'verify'],
  ])('opens the %s dialog', async (label, type) => {
    await openPbsTab()
    fireEvent.click(screen.getByRole('button', { name: label }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(`Create ${type} job`)).toBeTruthy()
  })

  it('edits a prune job with its datastore in the URL', async () => {
    await openPbsTab()
    const row = screen.getByTestId('row-prune1')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lastCall('PUT', '/jobs/prune/prune1')).toBeTruthy())
    expect(lastCall('PUT', '/jobs/prune/prune1')!.url).toBe('/api/v1/pbs/p1/jobs/prune/prune1?store=ds1')
  })

  it('edits a tape job', async () => {
    await openPbsTab()
    fireEvent.click(within(screen.getByTestId('row-tape1')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/^Drive/) as HTMLInputElement).value).toBe('drive0')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastCall('PUT', '/jobs/tape/tape1')).toBeTruthy())
  })

  it('deletes a prune job and runs a sync job', async () => {
    await openPbsTab()
    fireEvent.click(within(screen.getByTestId('row-prune1')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(lastCall('DELETE', '/jobs/prune/prune1')!.url).toBe('/api/v1/pbs/p1/jobs/prune/prune1?store=ds1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(screen.getByTestId('row-sync1')).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(lastCall('POST', '/jobs/sync/sync1/run')).toBeTruthy())
  })

  it('sends the picked schedule and shows network failures', async () => {
    failing = ['POST /jobs/sync', 'DELETE /jobs/', 'POST /run']
    await openPbsTab()
    fireEvent.click(screen.getByRole('button', { name: 'Create Sync Job' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Job ID/), { target: { value: 'j' } })
    fireEvent.change(within(dialog).getByLabelText('schedule'), { target: { value: 'hourly' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(lastCall('POST', '/jobs/sync')!.body).toMatchObject({ schedule: 'hourly' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(screen.getByTestId('row-sync1')).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(screen.getAllByText('network down: POST').length).toBeGreaterThan(0))

    fireEvent.click(within(screen.getByTestId('row-sync1')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('network down: DELETE')).toBeTruthy()
  })

  it('shows a failed PBS job list', async () => {
    failing = ['GET /api/v1/pbs/p1/jobs']
    renderWithProviders(<BackupJobsTabs pbsConnections={PBS} />)
    fireEvent.click(screen.getByText('Backup jobs'))
    fireEvent.click(screen.getByRole('tab', { name: /PBS/ }))
    expect(await screen.findByText('network down: GET')).toBeTruthy()
  })

  it('says when no PBS server is configured', () => {
    renderWithProviders(<BackupJobsTabs pveConnections={PVE} />)
    fireEvent.click(screen.getByText('Backup jobs'))
    fireEvent.click(screen.getByRole('tab', { name: /PBS/ }))
    expect(screen.getByText(/No PBS server configured/)).toBeTruthy()
  })
})

describe('BackupJobsTabs, restore drills', () => {
  it('opens the drills tab on a drill request when the feature is licensed', () => {
    state.drills = true
    renderWithProviders(<BackupJobsTabs pveConnections={PVE} drillRequest={{ nonce: 7 }} />)
    expect(screen.getByTestId('drills').textContent).toBe('7')
  })
})
