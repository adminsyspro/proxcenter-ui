/**
 * Component tests for BulkRestoreWizard.tsx (issue #983).
 *
 * What they cover that bulkRestore.test.ts cannot: the wizard's own wiring.
 * The flat PBS listing folded into guests on screen, the step guards, and the
 * dispatch loop (one POST per guest, the next one only when a slot frees up,
 * the PVE task status driving the row).
 *
 * Gotchas carried over from RestoreVmDialog.test.tsx:
 *   - the dialog renders in a MUI portal: assert through screen.*
 *   - a MUI Select opens on mouseDown, not click
 *   - MSW runs with onUnhandledRequest:'error', so every endpoint the wizard
 *     touches on open must be seeded
 * `pollIntervalMs` is driven down to 20 ms so the queue runs at test speed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import BulkRestoreWizard from './BulkRestoreWizard'

const PBS_ID = 'pbs-1'
const CONN_ID = 'conn-1'

function snapshot(over: Record<string, unknown> = {}) {
  return {
    id: `snap-${Math.random()}`,
    datastore: 'ds1',
    namespace: '',
    backupType: 'vm',
    backupId: '100',
    vmName: 'web-01',
    backupTime: 1_700_000_000,
    backupTimeFormatted: '2023-11-14 22:13',
    backupTimeIso: '2023-11-14T22:13:20Z',
    size: 1024,
    sizeFormatted: '1 KiB',
    verified: true,
    protected: false,
    ...over,
  }
}

const backups = [
  snapshot({ backupId: '100', vmName: 'web-01', backupTime: 300, backupTimeFormatted: 'newest-100', backupTimeIso: 'iso-100-new' }),
  snapshot({ backupId: '100', vmName: 'web-01', backupTime: 100, backupTimeFormatted: 'oldest-100', backupTimeIso: 'iso-100-old' }),
  snapshot({ backupId: '200', vmName: 'db-01', backupTime: 200, backupTimeFormatted: 'only-200', backupTimeIso: 'iso-200' }),
  // Host backups are not restorable and must never reach the list.
  snapshot({ backupType: 'host', backupId: 'srv1', vmName: '' }),
]

/** POST bodies the wizard sent, in order. */
let restorePosts: any[]
/** How many times each UPID was polled. */
let taskState: Record<string, { status: string; exitstatus?: string }>

function seedHandlers() {
  restorePosts = []
  taskState = {}
  server.use(
    http.get('*/api/v1/pbs/:id/backups', () =>
      HttpResponse.json({ data: { backups, namespaces: [''], bindings: [], stats: {}, warnings: [], pagination: {} } }),
    ),
    http.get('*/api/v1/connections', () =>
      HttpResponse.json({ data: [{ id: CONN_ID, name: 'pve-cluster-1' }] }),
    ),
    http.get('*/api/v1/connections/:id/nodes', () =>
      HttpResponse.json({ data: [{ node: 'pve1', status: 'online' }] }),
    ),
    http.get('*/api/v1/connections/:id/nodes/:node/storages', () =>
      HttpResponse.json({ data: [{ storage: 'local-zfs', type: 'zfspool' }] }),
    ),
    http.get('*/api/v1/connections/:id/resources', () =>
      HttpResponse.json({ data: [{ vmid: 100 }, { vmid: 9000 }] }),
    ),
    http.post('*/api/v1/connections/:id/nodes/:node/restore', async ({ request }) => {
      const body = await request.json()
      restorePosts.push(body)
      const upid = `UPID:pve1:restore:${(body as any).vmid}:`
      taskState[upid] = { status: 'running' }
      return HttpResponse.json({ data: upid })
    }),
    http.get('*/api/v1/tasks/:conn/:node/:upid', ({ params }) => {
      const upid = decodeURIComponent(String(params.upid))
      const state = taskState[upid] || { status: 'running' }
      return HttpResponse.json({ ...state, progress: 50, message: 'restoring' })
    }),
  )
}

function finishTask(vmid: number, exitstatus = 'OK') {
  taskState[`UPID:pve1:restore:${vmid}:`] = { status: 'stopped', exitstatus }
}

function renderWizard() {
  return renderWithProviders(
    <BulkRestoreWizard open onClose={vi.fn()} pbsId={PBS_ID} pollIntervalMs={20} />,
  )
}

// jsdom does not resolve a MUI Select's aria-labelledby, so selects are
// reached by index (same workaround as RestoreVmDialog.test.tsx). On the
// target step they render in this order.
const SELECT = { cluster: 0, node: 1, storage: 2, vmidPolicy: 3 } as const

async function chooseFromSelect(index: number, option: RegExp) {
  const combos = await screen.findAllByRole('combobox')
  expect(combos.length).toBeGreaterThan(index)
  fireEvent.mouseDown(combos[index])
  const item = await screen.findByRole('option', { name: option })
  fireEvent.click(item)
}

async function gotoTargetStep() {
  const rowCheckboxes = await screen.findAllByRole('checkbox')
  // [0] is the grid's select-all header checkbox.
  fireEvent.click(rowCheckboxes[1])
  fireEvent.click(rowCheckboxes[2])
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
  await chooseFromSelect(SELECT.cluster, /pve-cluster-1/)
  await chooseFromSelect(SELECT.node, /pve1/)
}

beforeEach(() => { seedHandlers() })
afterEach(() => { cleanup() })

describe('BulkRestoreWizard: guest list', () => {
  it('folds the flat snapshot list into one row per guest, host backups excluded', async () => {
    renderWizard()

    expect(await screen.findByText('web-01')).toBeTruthy()
    expect(await screen.findByText('db-01')).toBeTruthy()
    expect(screen.queryByText('srv1')).toBeNull()
  })

  it('defaults each guest to its newest restore point', async () => {
    renderWizard()

    expect(await screen.findByText(/newest-100/)).toBeTruthy()
    expect(screen.queryByText(/oldest-100/)).toBeNull()
  })

  it('requires a selection before leaving the first step', async () => {
    renderWizard()

    await screen.findByText('web-01')
    const next = screen.getByRole('button', { name: /^Next/ })
    expect((next as HTMLButtonElement).disabled).toBe(true)

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect((screen.getByRole('button', { name: /^Next/ }) as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('BulkRestoreWizard: target step', () => {
  it('blocks the original-VMID policy while a target VMID is taken, and unblocks it after an explicit overwrite confirm', async () => {
    renderWizard()
    await screen.findByText('web-01')
    await gotoTargetStep()

    await chooseFromSelect(SELECT.vmidPolicy, /Original VMID/)

    // VM 100 is live on the target cluster (see the resources handler), VM 200
    // is not: the message is the ICU singular, hence `exists?`.
    expect(await screen.findByText(/already exists? on the target cluster/)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: /^Next$/ }) as HTMLButtonElement).disabled).toBe(true))

    // A MUI Switch's input has no accessible name under jsdom: reach it
    // through its FormControlLabel text.
    const overwrite = screen.getByText('Overwrite the existing guests').closest('label')!.querySelector('input')!
    fireEvent.click(overwrite)
    expect(await screen.findByText(/will be replaced by (its|their) backups?/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Next$/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: /^Next$/ }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('skips the VMIDs already live on the target when allocating the range', async () => {
    renderWizard()
    await screen.findByText('web-01')
    await gotoTargetStep()

    // Default range is 9000-9099 and 9000 is taken, so the two guests land on
    // 9001 and 9002.
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    expect(await screen.findByText('9001')).toBeTruthy()
    expect(screen.getByText('9002')).toBeTruthy()
  })
})

describe('BulkRestoreWizard: dispatch queue', () => {
  it('starts one restore at a time and only frees the slot when the task ends', async () => {
    renderWizard()
    await screen.findByText('web-01')
    await gotoTargetStep()
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))

    fireEvent.click(await screen.findByRole('button', { name: /Restore 2 guests/ }))

    await waitFor(() => expect(restorePosts.length).toBe(1))
    expect(restorePosts[0]).toMatchObject({
      vmid: 9001,
      type: 'qemu',
      unique: true,
      pbsBackup: { pbsId: PBS_ID, datastore: 'ds1', namespace: '', backupPath: 'backup/vm/100/iso-100-new' },
    })

    // The queue must hold the second guest while the first task runs.
    await new Promise(r => setTimeout(r, 120))
    expect(restorePosts.length).toBe(1)

    finishTask(9001)
    await waitFor(() => expect(restorePosts.length).toBe(2), { timeout: 3000 })
    expect(restorePosts[1]).toMatchObject({ vmid: 9002, pbsBackup: { backupPath: 'backup/vm/200/iso-200' } })

    finishTask(9002)
    expect(await screen.findByText(/Finished: 2 restored, 0 failed/, {}, { timeout: 3000 })).toBeTruthy()

    // A guest restored twice would silently double the work and, on the
    // overwrite path, destroy what the first restore just wrote.
    const targets = restorePosts.map(p => p.vmid)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('marks a guest failed without stopping the batch', async () => {
    renderWizard()
    await screen.findByText('web-01')
    await gotoTargetStep()
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Restore 2 guests/ }))

    await waitFor(() => expect(restorePosts.length).toBe(1))
    finishTask(9001, 'storage full')
    await waitFor(() => expect(restorePosts.length).toBe(2), { timeout: 3000 })
    finishTask(9002)

    expect(await screen.findByText(/Finished: 1 restored, 1 failed/, {}, { timeout: 3000 })).toBeTruthy()
  })
})
