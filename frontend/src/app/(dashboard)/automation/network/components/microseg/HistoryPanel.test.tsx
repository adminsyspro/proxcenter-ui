/**
 * History sub-tab (UA60): one table of the revisions (counts, diff against the previous one, a Restore that follows
 * its run in the strip) and the runs (status, duration, the result in a drawer loaded on demand), newest first,
 * filtered on All / Revisions / Runs and paged ten rows at a time.
 */

import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegRevision, MicrosegRun } from '@/lib/microseg/types'

import HistoryPanel from './HistoryPanel'
import { GUESTS_ROUTE, calls, flow, mock, policy, renderTab, reply, resetMocks, zone } from './microsegTestKit'
import { body } from './policyTestKit'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

const REVISIONS = 'GET /revisions?limit=100'
const RUNS = 'GET /runs?limit=100'

const rev = (version: number, over: Partial<MicrosegRevision> = {}): MicrosegRevision => ({
  id: `rev-${version}`, version, author: 'ana', created_at: '2026-11-02T09:30:00Z',
  snapshot: { tag_prefix: 'zone-', zones: [zone('web'), zone('db')], flows: [flow('f1')] }, ...over,
})

const runOf = (n: number, over: Partial<MicrosegRun> = {}): MicrosegRun => ({
  id: `run-${n}`, policy_id: 'p1', kind: 'apply', status: 'done', started_at: '2026-11-02T10:00:00Z', duration_ms: 1500,
  api_calls: 12, writes: 4, error: '', ...over,
})

function setup(opts: { revisions?: MicrosegRevision[]; runs?: MicrosegRun[] } = {}) {
  const current = policy({ zones: [zone('web')], version: 3, last_revision: { id: 'rev-9', version: 9, author: 'ana', created_at: '2026-11-02T09:30:00Z' } })
  const handlers = { reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), goToSubTab: vi.fn(), onOpenPlan: vi.fn() }
  mock.routes[REVISIONS] = () => reply(200, { revisions: opts.revisions ?? [] })
  mock.routes[RUNS] = () => reply(200, { runs: opts.runs ?? [], limit: 100, offset: 0 })
  renderTab(<HistoryPanel connectionId='c1' policy={current} {...handlers} />)
  return handlers
}

const rowOf = (name: string | RegExp) => screen.findByRole('row', { name })
const dataRows = () => screen.queryAllByRole('row').filter(r => r.hasAttribute('data-row'))

describe('the history table', () => {
  it('has a column per field and lists the revisions and the runs newest first', async () => {
    setup({
      revisions: [rev(9, { created_at: '2026-11-02T11:00:00Z' }), rev(8, { created_at: '2026-11-01T09:00:00Z' })],
      runs: [runOf(1, { started_at: '2026-11-02T10:00:00Z' }), runOf(2, { kind: 'full', started_at: '2026-11-02T12:00:00Z' })],
    })
    await rowOf('Version 9')
    const head = within(screen.getByRole('table', { name: 'History' })).getAllByRole('columnheader').map(h => h.textContent)
    expect(head).toEqual(['Date', 'Type', 'Actor', 'Summary', 'Result', 'Duration', 'Actions'])
    expect(dataRows().map(r => r.getAttribute('aria-label'))).toEqual([
      'Full check, started Nov 2, 2026, 12:00 PM', 'Version 9', 'Apply, started Nov 2, 2026, 10:00 AM', 'Version 8',
    ])
  })

  it('shows All, Revisions or Runs', async () => {
    setup({ revisions: [rev(9)], runs: [runOf(1)] })
    await rowOf('Version 9')
    fireEvent.click(screen.getByTestId('history-kind-revisions'))
    await waitFor(() => expect(dataRows().map(r => r.getAttribute('data-row'))).toEqual(['revision']))
    fireEvent.click(screen.getByTestId('history-kind-runs'))
    await waitFor(() => expect(dataRows().map(r => r.getAttribute('data-row'))).toEqual(['run']))
    fireEvent.click(screen.getByTestId('history-kind-all'))
    await waitFor(() => expect(dataRows()).toHaveLength(2))
  })

  it('pages the rows ten at a time', async () => {
    setup({ revisions: Array.from({ length: 12 }, (_, i) => rev(20 - i, { created_at: `2026-11-${String(20 - i).padStart(2, '0')}T09:00:00Z` })) })
    await rowOf('Version 20')
    expect(dataRows()).toHaveLength(10)
    expect(screen.queryByRole('row', { name: 'Version 10' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await rowOf('Version 10')).toBeTruthy()
    expect(dataRows()).toHaveLength(2)
  })

  it('says there is nothing yet', async () => {
    setup()
    expect(await screen.findByText('Nothing recorded yet: the first apply records a revision.')).toBeTruthy()
  })
})

describe('revisions', () => {
  it('shows the version, the author, the counts and what changed against the previous revision, Applied and Latest', async () => {
    setup({ revisions: [
      rev(9, { snapshot: { tag_prefix: 'zone-', zones: [zone('web'), zone('db')], flows: [flow('f1'), { ...flow('f2'), dport: '443' }] } }),
      rev(8, { snapshot: { tag_prefix: 'zone-', zones: [zone('web')], flows: [{ ...flow('f2'), dport: '80' }, flow('f3')] } }),
    ] })
    const line = await rowOf('Version 9')
    expect(within(line).getByText('Revision applied v9')).toBeTruthy()
    expect(within(line).getByText('ana')).toBeTruthy()
    // db and f1 added, f3 removed, f2 changed (port).
    expect(within(line).getByTestId('history-summary').textContent).toBe('2 zones, 2 flows · +2 −1 ~1 vs previous')
    expect(within(line).getByText('Applied')).toBeTruthy()
    expect(within(line).getByText('Latest')).toBeTruthy()
    const older = screen.getByRole('row', { name: 'Version 8' })
    expect(within(older).getByTestId('history-summary').textContent).toBe('1 zone, 2 flows')
    expect(within(older).queryByText('Latest')).toBeNull()
  })

  it('says "-" for a revision recorded without an author', async () => {
    setup({ revisions: [rev(9), rev(8, { author: '  ' })] })
    const empty = await rowOf('Version 8')
    expect(within(empty).getAllByText('-').length).toBeGreaterThan(0)
    expect(within(empty).queryByText('ana')).toBeNull()
  })
})

describe('restore', () => {
  const ask = async (version = 8) => {
    const line = await rowOf(`Version ${version}`)
    fireEvent.click(within(line).getByRole('button', { name: 'Restore' }))
    return screen.findByRole('dialog', { name: `Restore version ${version}?` })
  }
  it('restores a revision after confirmation, with the current draft version, and follows the run', async () => {
    mock.routes['POST /revisions/rev-8/restore'] = () => reply(202, { run_id: 'run-77' })
    const { startRun } = setup({ revisions: [rev(9), rev(8)] })
    const dialog = await ask()

    expect(calls('POST /revisions/rev-8/restore')).toHaveLength(0)
    expect(within(dialog).getByText(/queued member changes are dropped/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(body(calls('POST /revisions/rev-8/restore')[0][1])).toEqual({ version: 3 })
    expect(startRun.mock.calls[0][0]).toMatchObject({ runId: 'run-77', kind: 'restore' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Restore version 8?' })).toBeNull())
  })

  it('restores nothing when cancelled', async () => {
    const { startRun } = setup({ revisions: [rev(8)] })
    const dialog = await ask()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Restore version 8?' })).toBeNull())
    expect(calls('POST /revisions/rev-8/restore')).toHaveLength(0)
    expect(startRun).not.toHaveBeenCalled()
  })

  it('reloads the draft on a 409 and keeps the confirmation open', async () => {
    mock.routes['POST /revisions/rev-8/restore'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'conflict' })
    const { reloadPolicy, startRun } = setup({ revisions: [rev(8)] })
    const dialog = await ask()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/changed elsewhere/i)).toBeTruthy()
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    expect(startRun).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Restore version 8?' })).toBeTruthy()
  })

  it('shows why the restore did not start on a 409 BUSY', async () => {
    mock.routes['POST /revisions/rev-8/restore'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup({ revisions: [rev(8)] })
    const dialog = await ask()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/Another operation is running/)).toBeTruthy()
  })
})

describe('runs', () => {
  it('shows a row per run: type, actor, writes and calls, the error, status and duration', async () => {
    setup({ runs: [runOf(1), runOf(2, { kind: 'full', status: 'failed', api_calls: 1, writes: 1, duration_ms: 90, error: 'cluster unreachable' })] })
    const ok = await rowOf('Apply, started Nov 2, 2026, 10:00 AM')
    expect(within(ok).getByText('Run: Apply')).toBeTruthy()
    expect(within(ok).getByText('Administrator')).toBeTruthy()
    expect(within(ok).getByTestId('history-summary').textContent).toBe('4 writes · 12 API calls')
    expect(within(ok).getByText('Done')).toBeTruthy()
    expect(within(ok).getByText('1.5s')).toBeTruthy()

    const failed = screen.getByRole('row', { name: 'Full check, started Nov 2, 2026, 10:00 AM' })
    expect(within(failed).getByText('Engine')).toBeTruthy()
    expect(within(failed).getByText('Failed')).toBeTruthy()
    expect(within(failed).getByTestId('history-summary').textContent).toBe('1 write · 1 API call')
    expect(within(failed).getByText('cluster unreachable')).toBeTruthy()
  })

  it('loads the result of a run only when its details open, in a drawer', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(200, runOf(1, {
      result: {
        guests: 3, members: 2, steps: 5, drifts: 0,
        done: [{ index: 0, kind: 'ipset.sync', object: 'pcz-web', summary: 'sync the web IP set' }],
        failed: [{ index: 1, kind: 'guest.tags', object: '', summary: 'tag guest 101', error: 'permission denied', guest: { node: 'pve1', type: 'qemu', vmid: 101 } }],
        not_run: [],
      },
    }))
    mock.routes[GUESTS_ROUTE] = () => reply(200, { data: { vms: [] } })
    setup({ runs: [runOf(1)] })
    const line = await rowOf(/^Apply, started/)
    expect(calls('GET /runs/run-1')).toHaveLength(0)

    fireEvent.click(within(line).getByRole('button', { name: 'Details' }))
    const drawer = await screen.findByRole('region', { name: 'Details of the run: Apply' })
    expect(await within(drawer).findByText('3 guests, 2 members, 5 steps')).toBeTruthy()
    expect(within(drawer).getByText('1 done, 1 failed, 0 not run')).toBeTruthy()
    expect(calls('GET /runs/run-1')).toHaveLength(1)
  })

  it('shows the removal as complete with its notes, tags kept on the guests', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(200, runOf(1, {
      kind: 'remove',
      result: { guests: 0, members: 0, steps: 0, drifts: 0, complete: true, notes: ['the zone tags of the guests are kept: remove them in PVE, or redeploy the policy as is'] },
    }))
    setup({ runs: [runOf(1, { kind: 'remove' })] })
    fireEvent.click(within(await rowOf(/^Removal, started/)).getByRole('button', { name: 'Details' }))
    const drawer = await screen.findByRole('region', { name: 'Details of the run: Removal' })
    expect(await within(drawer).findByText('Removal complete.')).toBeTruthy()
    expect(within(drawer).getByText(/the zone tags of the guests are kept/)).toBeTruthy()
  })

  it('shows the error when the result cannot be loaded', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(404, { code: 'NOT_FOUND', error: 'gone' })
    setup({ runs: [runOf(1)] })
    fireEvent.click(within(await rowOf(/^Apply, started/)).getByRole('button', { name: 'Details' }))
    const drawer = await screen.findByRole('region', { name: 'Details of the run: Apply' })
    expect(await within(drawer).findByText('Not found. It may have been deleted.')).toBeTruthy()
  })
})
