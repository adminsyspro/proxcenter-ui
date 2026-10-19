import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import RestoreDrillScheduleDialog from './RestoreDrillScheduleDialog'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const PBS = [{ id: 'pbs-1', name: 'PBS lab' }, { id: 'pbs-2', name: 'PBS DR' }]

const SCHEDULE: any = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Nightly web', enabled: true,
  scope: { mode: 'vms', vmids: [100, 999] }, restore_point: 'latest_verified',
  source: { pbs_id: 'pbs-1', pbs_name: 'PBS lab', pbs_storage: 'pbs-prod', datastore: 'store1', namespace: 'prod' },
  connection_id: 'c1', node: 'pve2', target_storage: 'local-lvm', network_mode: 'link_down', bridge: '',
  calendar: 'mon,wed 03:00', vms_per_run: 3, created_by: 'admin@lab', rotation_last_vmid: 0, next_run_at: '', last_run: null,
  created_at: '', updated_at: '',
}

let posted: Array<{ method: string; url: string; body: any }>

function seed(overrides: { save?: () => Response } = {}) {
  posted = []
  server.use(
    http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({ default_network_mode: 'link_down', default_bridge: '' })),
    http.get('*/api/v1/pbs/pbs-1/datastores', () => HttpResponse.json({ data: [{ name: 'store1' }, { name: 'store0' }] })),
    http.get('*/api/v1/pbs/pbs-1/backups', () => HttpResponse.json({
      data: {
        backups: [
          { backupType: 'vm', backupId: '102', vmName: 'root-vm', namespace: '', backupTime: 1 },
          { backupType: 'vm', backupId: '100', vmName: 'web01', namespace: 'prod', backupTime: 1 },
          { backupType: 'vm', backupId: '101', vmName: 'db01', namespace: 'prod', backupTime: 1 },
          { backupType: 'ct', backupId: '200', vmName: 'ct01', namespace: 'prod', backupTime: 1 },
        ],
      },
    })),
    http.get('*/api/v1/pbs/pbs-1/pve-storages', () => HttpResponse.json({ data: [{ connId: 'c1', connName: 'PVE-PROD', storage: 'pbs-prod', nodes: [] }] })),
    http.get('*/api/v1/connections/c1/nodes', () => HttpResponse.json({ data: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }] })),
    http.get('*/api/v1/connections/c1/nodes/:node/storages', () => HttpResponse.json({ data: [{ storage: 'local-lvm', avail: 10 * 1024 ** 3 }] })),
    http.get('*/api/v1/connections/c1/nodes/:node/network', () => HttpResponse.json({ data: [{ iface: 'vmbr9', type: 'bridge' }] })),
    http.post('*/api/v1/backups/restore-drills/schedules', async ({ request }) => {
      posted.push({ method: 'POST', url: request.url, body: await request.json() })
      return overrides.save ? overrides.save() : HttpResponse.json({ schedule: { id: 'new' } }, { status: 201 })
    }),
    http.put('*/api/v1/backups/restore-drills/schedules/:id', async ({ request }) => {
      posted.push({ method: 'PUT', url: request.url, body: await request.json() })
      return overrides.save ? overrides.save() : HttpResponse.json({ schedule: SCHEDULE })
    }),
  )
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(() => cleanup())

function open(schedule: any = null) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  renderWithProviders(<RestoreDrillScheduleDialog schedule={schedule} pbsConnections={PBS} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(within(await screen.findByRole('listbox')).getByText(option))
}

const storageSelected = () => waitFor(() => expect(screen.getByRole('combobox', { name: 'Disk storage' })).toHaveTextContent('local-lvm'))

// The dialog chains several requests (clusters, node, storages, VMs) before
// a field settles; under the CI coverage run that takes more than the default
// one second of the async queries.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout
beforeAll(() => configure({ asyncUtilTimeout: 8000 }))
afterAll(() => configure({ asyncUtilTimeout: defaultAsyncTimeout }))

describe('RestoreDrillScheduleDialog', { timeout: 30_000 }, () => {
  it('shows the inline errors instead of saving an incomplete schedule', async () => {
    seed()
    open()
    await storageSelected()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Choose at least one VM')).toBeInTheDocument()
    expect(posted).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(101) } })
    expect(screen.getByText('100 characters at most')).toBeInTheDocument()
  })

  it('creates a schedule with the chosen namespace, VMs, restore point, target and recurrence', async () => {
    seed()
    const { onClose, onSaved } = open()
    expect(screen.getByText('New restore drill schedule')).toBeInTheDocument()
    await storageSelected()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Nightly web ' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Namespace' })).toHaveTextContent('Root'))
    await pick('Namespace', 'prod')

    const vms = screen.getByRole('combobox', { name: 'VMs' })
    fireEvent.mouseDown(vms)
    fireEvent.change(vms, { target: { value: 'web' } })
    fireEvent.click(await screen.findByText('100 web01'))
    fireEvent.change(vms, { target: { value: '101' } })
    fireEvent.click(await screen.findByText('101 db01'))
    expect(screen.queryByText('200 ct01')).toBeNull()

    await pick('Restore point', 'Latest verified backup')
    fireEvent.change(screen.getByLabelText('VMs per pass'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('Isolated bridge'))
    await pick('Bridge', 'vmbr9')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posted).toEqual([{
      method: 'POST',
      url: expect.stringMatching(/\/api\/v1\/backups\/restore-drills\/schedules$/),
      body: {
        name: 'Nightly web', enabled: true, scope: { mode: 'vms', vmids: [100, 101] }, restore_point: 'latest_verified',
        source: { pbs_id: 'pbs-1', datastore: 'store0', namespace: 'prod' }, connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm',
        network_mode: 'bridge', bridge: 'vmbr9', calendar: '02:00', vms_per_run: 2,
      },
    }])
    expect(toast.success).toHaveBeenCalledWith('Schedule created')
    expect(onSaved).toHaveBeenCalledWith({ id: 'new' })
  })

  it('an "all" scope needs no VM, a bridge mode needs a bridge', async () => {
    seed()
    open()
    await storageSelected()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'All of it' } })
    fireEvent.click(screen.getByLabelText('All VMs of this datastore and namespace'))
    expect(screen.queryByRole('combobox', { name: 'VMs' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Isolated bridge'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Choose an isolated bridge')).toBeInTheDocument()
    expect(posted).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('Disconnect all NICs (link_down)'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body).toMatchObject({ scope: { mode: 'all', vmids: [] }, source: { namespace: '' }, network_mode: 'link_down', bridge: '' })
  })

  it('edits a stored schedule in place, keeping a VM that has no backup any more', async () => {
    seed()
    const { onClose } = open(SCHEDULE)
    expect(screen.getByText('Edit schedule Nightly web')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Nightly web')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Node' })).toHaveTextContent('pve2'))
    await storageSelected()
    expect(screen.getByText('100 web01')).toBeInTheDocument()
    expect(screen.getByText('999')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Namespace' })).toHaveTextContent('prod')
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posted[0].method).toBe('PUT')
    expect(posted[0].url).toMatch(new RegExp(`/schedules/${SCHEDULE.id}$`))
    expect(posted[0].body).toMatchObject({
      enabled: false, scope: { mode: 'vms', vmids: [100, 999] }, node: 'pve2', calendar: 'mon,wed 03:00', vms_per_run: 3,
      source: { pbs_id: 'pbs-1', datastore: 'store1', namespace: 'prod' },
    })
    expect(toast.success).toHaveBeenCalledWith('Schedule saved')
  })

  it('keeps the dialog open with the server refusal', async () => {
    seed({ save: () => HttpResponse.json({ error: 'unsupported calendar expression' }, { status: 400 }) })
    const { onClose } = open(SCHEDULE)
    await storageSelected()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save the schedule: unsupported calendar expression')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a server out of reach, and changes the PBS', async () => {
    seed()
    server.use(
      http.put('*/api/v1/backups/restore-drills/schedules/:id', () => HttpResponse.error()),
      http.get('*/api/v1/pbs/pbs-2/datastores', () => HttpResponse.json({ data: [] })),
    )
    open(SCHEDULE)
    await storageSelected()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/^Could not save the schedule: /)).toBeInTheDocument()
    await pick('PBS server', 'PBS DR')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Choose a PBS server and a datastore')).toBeInTheDocument()
  })
})
