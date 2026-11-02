/**
 * History sub-tab: the revisions with their counts and a Restore that follows
 * its run in the strip, and the runs list with the result loaded on demand.
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
const RUNS = 'GET /runs?limit=11'

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
  mock.routes[RUNS] = () => reply(200, { runs: opts.runs ?? [], limit: 11, offset: 0 })
  renderTab(<HistoryPanel connectionId='c1' policy={current} {...handlers} />)
  return handlers
}

describe('revisions', () => {
  it('shows a line per revision with its author, date and the counts of its snapshot', async () => {
    setup({ revisions: [rev(9), rev(8, { snapshot: { tag_prefix: 'zone-', zones: [zone('web')], flows: [] } })] })
    const line = await screen.findByRole('listitem', { name: 'Version 9' })
    expect(within(line).getByText('Version 9')).toBeTruthy()
    expect(within(line).getByText(/by ana/)).toBeTruthy()
    expect(within(line).getByText(/Nov 2, 2026/)).toBeTruthy()
    expect(within(line).getByText('2 zones, 1 flow')).toBeTruthy()
    expect(within(line).getByText('Latest')).toBeTruthy()
    const older = screen.getByRole('listitem', { name: 'Version 8' })
    expect(within(older).getByText('1 zone, 0 flows')).toBeTruthy()
    expect(within(older).queryByText('Latest')).toBeNull()
  })

  it('shows the zones of a revision under its chevron', async () => {
    setup({ revisions: [rev(9)] })
    const line = await screen.findByRole('listitem', { name: 'Version 9' })
    expect(within(line).queryByText(/Zones: web, db/)).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(await within(line).findByText('Zones: web, db')).toBeTruthy()
    expect(within(line).getByText('Tag prefix: zone-')).toBeTruthy()
  })

  it('pages the revisions ten at a time', async () => {
    setup({ revisions: Array.from({ length: 12 }, (_, i) => rev(20 - i)) })
    await screen.findByRole('listitem', { name: 'Version 20' })
    expect(screen.getAllByRole('listitem', { name: /^Version / })).toHaveLength(10)
    expect(screen.queryByRole('listitem', { name: 'Version 10' })).toBeNull()
    fireEvent.click(within(screen.getByRole('region', { name: 'Revisions' })).getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('listitem', { name: 'Version 10' })).toBeTruthy()
    expect(screen.getAllByRole('listitem', { name: /^Version / })).toHaveLength(2)
  })

  it('says there is no revision yet', async () => {
    setup()
    expect(await screen.findByText('No revision yet: the first apply records one.')).toBeTruthy()
  })
})

describe('restore', () => {
  const ask = async (version = 8) => {
    const line = await screen.findByRole('listitem', { name: `Version ${version}` })
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
  it('shows a line per run: kind, status, start, duration, calls, writes and the error', async () => {
    setup({ runs: [runOf(1), runOf(2, { kind: 'full', status: 'failed', api_calls: 1, writes: 1, duration_ms: 90, error: 'cluster unreachable' })] })
    const ok = await screen.findByRole('listitem', { name: 'Apply, started Nov 2, 2026, 10:00 AM' })
    expect(within(ok).getByText('Done')).toBeTruthy()
    expect(within(ok).getByText('1.5s')).toBeTruthy()
    expect(within(ok).getByText('12 API calls')).toBeTruthy()
    expect(within(ok).getByText('4 writes')).toBeTruthy()

    const failed = screen.getByRole('listitem', { name: 'Full check, started Nov 2, 2026, 10:00 AM' })
    expect(within(failed).getByText('Failed')).toBeTruthy()
    expect(within(failed).getByText('1 API call')).toBeTruthy()
    expect(within(failed).getByText('1 write')).toBeTruthy()
    expect(within(failed).getByText('cluster unreachable')).toBeTruthy()
  })

  it('pages the runs from the server: a page is asked with one more to know if another follows', async () => {
    const page1 = Array.from({ length: 11 }, (_, i) => runOf(i + 1))
    mock.routes['GET /runs?limit=11&offset=10'] = () => reply(200, { runs: [runOf(11)], limit: 11, offset: 10 })
    setup({ runs: page1 })
    await screen.findAllByRole('listitem', { name: /^Apply, started/ })
    expect(screen.getAllByRole('listitem', { name: /^Apply, started/ })).toHaveLength(10)

    const runs = within(screen.getByRole('region', { name: 'Runs' }))
    fireEvent.click(runs.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(calls('GET /runs?limit=11&offset=10')).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Apply, started/ })).toHaveLength(1))
    expect((runs.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says there is no run yet', async () => {
    setup()
    expect(await screen.findByText('No run yet.')).toBeTruthy()
  })

  it('loads the result of a run only when its chevron is opened', async () => {
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
    const line = await screen.findByRole('listitem', { name: /^Apply, started/ })
    expect(calls('GET /runs/run-1')).toHaveLength(0)

    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(await within(line).findByText('3 guests, 2 members, 5 steps')).toBeTruthy()
    expect(within(line).getByText('1 done, 1 failed, 0 not run')).toBeTruthy()
    expect(calls('GET /runs/run-1')).toHaveLength(1)
  })

  it('shows the removal as complete with its notes, tags kept on the guests', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(200, runOf(1, {
      kind: 'remove',
      result: { guests: 0, members: 0, steps: 0, drifts: 0, complete: true, notes: ['the zone tags of the guests are kept: remove them in PVE, or redeploy the policy as is'] },
    }))
    setup({ runs: [runOf(1, { kind: 'remove' })] })
    const line = await screen.findByRole('listitem', { name: /^Removal, started/ })
    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(await within(line).findByText('Removal complete.')).toBeTruthy()
    expect(within(line).getByText(/the zone tags of the guests are kept/)).toBeTruthy()
  })

  it('shows an incomplete removal as such', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(200, runOf(1, {
      kind: 'remove', status: 'failed', error: 'step failed',
      result: { guests: 1, members: 1, steps: 1, drifts: 0, complete: false, notes: ['the removal is not complete: run it again'] },
    }))
    setup({ runs: [runOf(1, { kind: 'remove', status: 'failed', error: 'step failed' })] })
    const line = await screen.findByRole('listitem', { name: /^Removal, started/ })
    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(await within(line).findByText('Removal incomplete: run it again.')).toBeTruthy()
  })

  it('shows the error when the result cannot be loaded', async () => {
    mock.routes['GET /runs/run-1'] = () => reply(404, { code: 'NOT_FOUND', error: 'gone' })
    setup({ runs: [runOf(1)] })
    const line = await screen.findByRole('listitem', { name: /^Apply, started/ })
    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(await within(line).findByText('Not found. It may have been deleted.')).toBeTruthy()
  })
})
