/**
 * "Check now" on the sub-tabs row: the button (read-only, nothing deployed, a check queued) and its window, queued,
 * then running, then the outcome rows and the log, with the relay stubbed at the fetch level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'
import type { MicrosegRun, MicrosegRunResult } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, resetMocks, status, zone } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'

const REQUESTED = '2026-11-03T10:00:00Z'

const runOf = (id: string, kind: string, startedAt: string, over: Partial<MicrosegRun> = {}): MicrosegRun => ({
  id, policy_id: 'p1', kind, status: 'done', started_at: startedAt, duration_ms: 4200, api_calls: 111, writes: 0, error: '', ...over,
})
const result = (over: Partial<MicrosegRunResult>) => ({ guests: 0, members: 0, steps: 0, drifts: 0, ...over }) as MicrosegRunResult

const statusWith = (checkPending: boolean) => status({ engine: { paused_until: null, held: false, check_pending: checkPending, last_runs: {}, last_log: null } })

const checkButton = () => screen.getByRole('button', { name: /Check now|Check requested/, hidden: true }) as HTMLButtonElement

async function openCheck() {
  const button = await screen.findByRole('button', { name: 'Check now' })
  fireEvent.click(button)
  return screen.findByRole('dialog', { name: 'Full check' })
}

beforeEach(() => {
  resetMocks()
  mock.routes['GET /drifts'] = () => reply(200, { drifts: [], computed: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Check now button', () => {
  it('sits on the sub-tabs row just before the emergency stop', async () => {
    renderTab()
    const button = await screen.findByRole('button', { name: 'Check now' })
    const stop = screen.getByRole('button', { name: 'Emergency stop' })
    expect(button.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const slot = screen.getByTestId('microseg-actions-slot')
    expect(slot.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('is disabled while nothing is deployed', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')] }))
    renderTab()
    expect((await screen.findByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says a check is requested, disabled, while the engine has one queued', async () => {
    mock.routes['GET /status'] = () => reply(200, statusWith(true))
    renderTab()
    const button = await screen.findByRole('button', { name: 'Check requested' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('is disabled for a read-only user, with the reason', async () => {
    const value: RBACContextValue = {
      permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
      hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false,
      hasPermissionOn: () => false, refresh: () => undefined,
    }
    renderTab(<RBACContext.Provider value={value}><MicrosegTab connectionId='c1' /></RBACContext.Provider>)
    const button = await screen.findByRole('button', { name: 'Check now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.mouseOver(button.parentElement as HTMLElement)
    expect(await screen.findByText('Read-only: you need node management rights')).toBeTruthy()
  })
})

describe('Check window', () => {
  it('waits in the queue, follows the run, then shows the check rows and the log; Open Drifts switches the sub-tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let pending = false
    let listed: MicrosegRun[] = []
    // The orchestrator answers an empty result for a run that has not ended.
    let full = runOf('f1', 'full', '2026-11-03T10:00:05Z', { status: 'running', api_calls: 0, result: {} as MicrosegRunResult })
    mock.routes['POST /check'] = () => { pending = true; return reply(202, { queued: true, requested_at: REQUESTED }) }
    mock.routes['GET /status'] = () => reply(200, statusWith(pending))
    mock.routes['GET /runs?limit=10'] = () => reply(200, { runs: listed, limit: 10, offset: 0 })
    mock.routes['GET /runs/f1'] = () => reply(200, full)
    mock.routes['GET /runs/i1'] = () => reply(200, runOf('i1', 'ips', '2026-11-03T10:00:02Z', { result: result({ members: 5, with_ips: 3 }) }))
    mock.routes['GET /runs/l1'] = () => reply(200, runOf('l1', 'log', '2026-11-03T10:00:12Z', { result: result({ events: 12, suggestions: 2, dropped_foreign_dst: 4 }) }))
    renderTab()

    const dialog = await openCheck()
    expect(within(dialog).getByText('Waiting for the engine (up to 60 s)')).toBeTruthy()
    await waitFor(() => expect(calls('POST /check')).toHaveLength(1))
    expect(calls('POST /check')[0][1]).toMatchObject({ method: 'POST', body: '{}' })
    await waitFor(() => expect(checkButton().textContent).toBe('Check requested'))
    // The queue is read through the shared status of the tab, every 5 s: one read, not one per poller.
    const statusReads = calls('GET /status').length
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(calls('GET /status').length).toBe(statusReads + 1)
    expect(calls('GET /runs?limit=10')).toHaveLength(0)

    // The engine takes the check: the IP collection, then the full run, are listed.
    pending = false
    listed = [full, runOf('i1', 'ips', '2026-11-03T10:00:02Z'), runOf('old', 'full', '2026-11-03T09:00:00Z')]
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(await within(dialog).findByText(/^In progress, \d+ s elapsed$/)).toBeTruthy()
    expect(within(dialog).getByText('The steps show once the run has ended.')).toBeTruthy()
    expect(calls('GET /runs/old')).toHaveLength(0)
    // The run is followed in the strip like the others.
    expect(screen.getAllByText('Full check in progress').length).toBeGreaterThan(0)
    // The window and the strip follow the run at once: their reads of it share one request.
    expect(calls('GET /runs/f1')).toHaveLength(1)

    full = runOf('f1', 'full', '2026-11-03T10:00:05Z', {
      result: result({
        guests: 32, members: 32, drifts: 14, trigger: 'check', steps: 1,
        done: [{ index: 0, kind: 'ipset.sync', object: 'zone-web', summary: 'sync zone-web' }],
      }),
      writes: 1,
    })
    listed = [runOf('l1', 'log', '2026-11-03T10:00:12Z'), ...listed]
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })

    expect(await within(dialog).findByRole('listitem', { name: 'Inventory read: passed' })).toBeTruthy()
    expect(within(dialog).getByText('32 guests')).toBeTruthy()
    expect(await within(dialog).findByRole('listitem', { name: 'IP collection: warning' })).toBeTruthy()
    expect(within(dialog).getByText('3 of 5 running members with an IP')).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { name: 'Proxmox objects compared: warning' })).toBeTruthy()
    expect(within(dialog).getByText('1 step planned, 1 write done')).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { name: 'Drifts: warning' })).toBeTruthy()
    expect(await within(dialog).findByRole('listitem', { name: 'Observation: passed' })).toBeTruthy()
    expect(within(dialog).getByText('12 events read, 2 suggestions')).toBeTruthy()

    // Under the chevron: what the row means.
    const observation = within(dialog).getByRole('listitem', { name: 'Observation: passed' })
    fireEvent.click(within(observation).getByRole('button', { name: 'Show details' }))
    expect(within(observation).getByText('12 events read in the firewall logs, 4 flooded packets ignored.')).toBeTruthy()

    // The log: one line per step.
    const log = within(dialog).getByRole('list', { name: 'Log' })
    expect(within(log).getByText('ipset.sync')).toBeTruthy()
    expect(within(log).getByText('done')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Run again' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Drifts' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Full check' })).toBeNull())
    expect(screen.getByRole('tab', { name: 'Drifts' }).getAttribute('aria-selected')).toBe('true')
  })

  it('passes the rows of a clean check and says when the pass had no IP collection', async () => {
    mock.routes['POST /check'] = () => reply(202, { queued: true, requested_at: REQUESTED })
    mock.routes['GET /status'] = () => reply(200, statusWith(false))
    mock.routes['GET /runs?limit=10'] = () => reply(200, { runs: [runOf('f1', 'full', '2026-11-03T10:00:05Z')], limit: 10, offset: 0 })
    mock.routes['GET /runs/f1'] = () => reply(200, runOf('f1', 'full', '2026-11-03T10:00:05Z', { result: result({ guests: 4, members: 2, trigger: 'check' }) }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderTab()

    await screen.findByRole('button', { name: 'Check now' })
    const policyReads = calls('GET /policy').length
    const dialog = await openCheck()
    expect(await within(dialog).findByRole('listitem', { name: 'Drifts: passed' })).toBeTruthy()
    // The end of the check reads the draft again (and the status, drifts, runs, revisions, suggestions).
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    expect(within(dialog).queryByRole('button', { name: 'Open Drifts' })).toBeNull()
    expect(within(dialog).getByRole('listitem', { name: 'Proxmox objects compared: passed' })).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { name: 'IP collection: not measured' })).toBeTruthy()
    // The log read is looked for a few times (the engine records it once it has ended), then said not measured.
    expect(within(dialog).getByRole('listitem', { name: 'Observation: reading...' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000) })
    const observation = await within(dialog).findByRole('listitem', { name: 'Observation: not measured' })
    fireEvent.click(within(observation).getByRole('button', { name: 'Show details' }))
    expect(within(observation).getByText('The firewall logs were not read during this check.')).toBeTruthy()
    expect(within(dialog).queryByText('No new event in the firewall logs.')).toBeNull()
    expect(within(dialog).getByText('No step: there was nothing to write.')).toBeTruthy()
  })

  it('opens in the queue on a 409 CHECK_PENDING and follows the next full run, not an older one', async () => {
    let lists = 0
    const old = runOf('old', 'full', '2026-11-03T09:00:00Z')
    mock.routes['POST /check'] = () => reply(409, { code: 'CHECK_PENDING', error: 'a check is already queued' })
    mock.routes['GET /status'] = () => reply(200, statusWith(false))
    mock.routes['GET /runs?limit=10'] = () => {
      lists += 1
      const runs = lists === 1 ? [old] : [runOf('f2', 'full', '2026-11-03T10:00:05Z', { status: 'running', api_calls: 0, result: null }), old]
      return reply(200, { runs, limit: 10, offset: 0 })
    }
    mock.routes['GET /runs/f2'] = () => reply(200, runOf('f2', 'full', '2026-11-03T10:00:05Z', { status: 'running', api_calls: 0, result: null }))
    renderTab()

    const dialog = await openCheck()
    expect(await within(dialog).findByText(/^In progress/)).toBeTruthy()
    expect(within(dialog).queryByText('a check is already queued')).toBeNull()
    expect(calls('GET /runs/old')).toHaveLength(0)
    expect(calls('GET /runs/f2').length).toBeGreaterThan(0)
  })

  it('shows a refusal in the window, and offers to run again', async () => {
    mock.routes['POST /check'] = () => reply(503, { code: 'NOT_LEADER', error: 'not the leader' })
    renderTab()
    const dialog = await openCheck()
    expect(await within(dialog).findByText('This orchestrator node is not the leader. Try again in a moment.')).toBeTruthy()

    mock.routes['POST /check'] = () => reply(404, { code: 'NOT_FOUND', error: 'no applied revision' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run again' }))
    expect(await within(dialog).findByText('Not deployed: apply a plan first, the engine only checks a deployed policy.')).toBeTruthy()
    expect(calls('POST /check')).toHaveLength(2)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Full check' })).toBeNull())
  })
})
