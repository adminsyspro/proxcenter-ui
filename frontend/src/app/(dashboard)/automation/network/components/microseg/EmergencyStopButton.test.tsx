/**
 * The Emergency stop of a policy shared by several clusters: one button stops or lifts every cluster, its confirmation
 * names them, a cluster whose own status has not followed yet is listed as pending, a cluster whose firewall the lift
 * keeps off says why, and a refused lift names the cluster the backend named only when the user may see it. A policy
 * of one cluster keeps its dialog and its banner as they were.
 */

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegStatus } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, resetMocks, status, zone, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { useMicrosegControls } from './useMicrosegControls'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Lets the clock run `ms` (fake timers), the reads it starts answered. */
const elapse = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const C2 = '/api/v1/firewall/microseg/c2'
const C3 = '/api/v1/firewall/microseg/c3'
const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
const link = (connection_id: string, over: { active?: boolean; stop_cluster_disabled?: boolean } = {}) => ({
  connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null, ...over,
})
const engineState = (firewall: 'enabled' | 'disabled') => ({ paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: firewall })
const stateOf = (stop: boolean, firewall: 'enabled' | 'disabled'): MicrosegStatus => status({ emergency_stop: stop, engine: engineState(firewall) })

type Link = ReturnType<typeof link>

/** A policy shared by c1 (the tab) and c2, each answering its own status; the links as the backend has them at each read. */
function shared(c1: () => MicrosegStatus, c2: () => MicrosegStatus, links: Link[] | (() => Link[]) = [link('c1'), link('c2')]) {
  const linksNow = typeof links === 'function' ? links : () => links
  mock.routes['GET /clusters'] = () => reply(200, { clusters: linksNow(), max: 8 })
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: linksNow() }))
  mock.routes['GET /status'] = () => reply(200, c1())
  mock.routes[`GET ${C2}/status`] = () => reply(200, c2())
  mock.routes[`GET ${C2}/drifts`] = () => reply(200, { drifts: [], computed: true })
  mock.routes['GET /drifts'] = () => reply(200, { drifts: [], computed: true })
}

const openStop = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
  return screen.findByRole('dialog')
}
const openResume = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
  return screen.findByRole('dialog')
}

describe('the stop of a shared policy', () => {
  it('names in its confirmation every cluster it stops', async () => {
    shared(() => stateOf(false, 'enabled'), () => stateOf(false, 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openStop()
    expect(await within(dialog).findByText('Stops every cluster of the policy: PVE-DR, PVE-PROD')).toBeTruthy()
  })

  it('says the stop moves every zone to observation on every associated cluster, not on "this connection"', async () => {
    shared(() => stateOf(false, 'enabled'), () => stateOf(false, 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openStop()
    await within(dialog).findByText(/Stops every cluster of the policy/)
    expect(within(dialog).getByText('Every zone of the policy moves to observation on all the associated clusters.')).toBeTruthy()
    expect(within(dialog).queryByText(/this connection/)).toBeNull()
  })

  it('counts, without naming it, a cluster the user cannot see', async () => {
    const links = [link('c1'), link('c2'), link('c3')]
    shared(() => stateOf(false, 'enabled'), () => stateOf(false, 'enabled'), links)
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openStop()
    expect(await within(dialog).findByText('Stops every cluster of the policy: PVE-DR, PVE-PROD and 1 other cluster')).toBeTruthy()
    expect(dialog.textContent).not.toContain('c3')
  })

  it('sends one request through the tab, then, once the first reads are done, lists the cluster whose firewall is still on as pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let stopped = false
    mock.routes['POST /emergency-stop'] = () => {
      stopped = true
      return reply(200, { accepted: true, applied_by: 'self', on: true })
    }
    // c1 followed at once; c2 could not be reached at that moment: its firewall is still on.
    shared(() => stateOf(stopped, stopped ? 'disabled' : 'enabled'), () => stateOf(stopped, 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openStop()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    expect(calls(`POST ${C2}/emergency-stop`)).toHaveLength(0)

    // Nothing flashes "pending" while the clusters have not had the time to follow.
    await elapse(2_000)
    expect(screen.queryByTestId('stop-follow')).toBeNull()
    await elapse(10_000)
    const follow = await screen.findByTestId('stop-follow')
    await waitFor(() => expect(within(follow).getAllByRole('listitem')).toHaveLength(1))
    const [line] = within(follow).getAllByRole('listitem')
    expect(within(line).getByText('PVE-DR')).toBeTruthy()
    expect(within(line).getByText('Stop pending: retried every minute')).toBeTruthy()
  })

  it('reads each status every 5 s while a cluster is pending, for 3 minutes at most, then at the usual pace with the line kept', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let stopped = false
    mock.routes['POST /emergency-stop'] = () => {
      stopped = true
      return reply(200, { accepted: true, applied_by: 'self', on: true })
    }
    shared(() => stateOf(stopped, stopped ? 'disabled' : 'enabled'), () => stateOf(stopped, 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    fireEvent.click(within(await openStop()).getByRole('button', { name: 'Emergency stop' }))
    await waitFor(() => expect(calls('POST /emergency-stop')).toHaveLength(1))
    await elapse(12_000)
    const reads = () => calls(`GET ${C2}/status`).length
    let before = reads()
    await elapse(30_000)
    expect(reads() - before).toBeGreaterThanOrEqual(5)
    await elapse(150_000)
    before = reads()
    await elapse(60_000)
    expect(reads() - before).toBeLessThanOrEqual(5)
    expect(within(screen.getByTestId('stop-follow')).getByText('Stop pending: retried every minute')).toBeTruthy()
  })

  it('lists nothing once every cluster followed', async () => {
    let stopped = false
    mock.routes['POST /emergency-stop'] = () => {
      stopped = true
      return reply(200, { accepted: true, applied_by: 'self', on: true })
    }
    shared(() => stateOf(stopped, stopped ? 'disabled' : 'enabled'), () => stateOf(stopped, stopped ? 'disabled' : 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    fireEvent.click(within(await openStop()).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Cluster firewall off: PVE-DR')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stop-follow')).toBeNull())
  })
})

describe('the lift of a shared policy', () => {
  it('says which cluster stays off until its node access rules are checked, then reads at the usual pace', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let lifted = false
    mock.routes['POST /emergency-stop'] = () => {
      lifted = true
      return reply(200, { accepted: true, applied_by: 'self', on: false })
    }
    shared(
      () => stateOf(!lifted, lifted ? 'enabled' : 'disabled'),
      () => stateOf(!lifted, 'disabled'),
      [link('c1', { stop_cluster_disabled: true }), link('c2', { stop_cluster_disabled: true })],
    )
    mock.routes[`GET ${C2}/drifts`] = () => reply(200, { drifts: lifted ? [{ kind: 'stop_lift_held', object: 'c2', detail: { socle_rules: false } }] : [], computed: true })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    fireEvent.click(within(await openResume()).getByRole('button', { name: 'Resume' }))

    const follow = await screen.findByTestId('stop-follow')
    await waitFor(() => expect(within(follow).queryByText('Firewall kept off until its node access rules are checked')).toBeTruthy())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await elapse(12_000)
    const lines = within(screen.getByTestId('stop-follow')).getAllByRole('listitem')
    expect(lines).toHaveLength(1)
    expect(within(lines[0]).getByText('PVE-DR')).toBeTruthy()
    expect(screen.getByTestId('stop-follow').textContent).not.toContain('pending')
    // Only a held cluster left: nothing to read faster.
    const before = calls(`GET ${C2}/status`).length
    await elapse(60_000)
    expect(calls(`GET ${C2}/status`).length - before).toBeLessThanOrEqual(5)
  })

  it('follows a stop then a lift of the same session, the policy read again after each', async () => {
    let stop = false
    let lifted = false
    mock.routes['POST /emergency-stop'] = (init?: RequestInit) => {
      const on = JSON.parse(String(init?.body)).on as boolean
      stop = on
      lifted = !on
      return reply(200, { accepted: true, applied_by: 'self', on })
    }
    // The backend's links: the stop turns both cluster firewalls off and records it; the lift re-enables c1 only.
    shared(
      () => stateOf(stop, stop ? 'disabled' : 'enabled'),
      () => stateOf(stop, stop || lifted ? 'disabled' : 'enabled'),
      () => [link('c1', { stop_cluster_disabled: stop }), link('c2', { stop_cluster_disabled: stop || lifted })],
    )
    mock.routes[`GET ${C2}/drifts`] = () => reply(200, { drifts: lifted ? [{ kind: 'stop_lift_held', object: 'c2', detail: { socle_rules: false } }] : [], computed: true })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const policyReads = calls('GET /policy').length
    fireEvent.click(within(await openStop()).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Cluster firewall off: PVE-DR')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    fireEvent.click(within(await openResume()).getByRole('button', { name: 'Resume' }))
    const follow = await screen.findByTestId('stop-follow')
    await waitFor(() => expect(within(follow).getByText('Firewall kept off until its node access rules are checked')).toBeTruthy())
  })

  it('names in the refusal the cluster whose management rules are missing, never the text of the backend', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'the emergency stop is kept on connection c2: rule SSH 22 missing' })
    shared(() => stateOf(true, 'disabled'), () => stateOf(true, 'disabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openResume()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText(/so the cluster firewall was not re-enabled/)).toBeTruthy()
    expect(within(dialog).getByText('Refused on PVE-DR.')).toBeTruthy()
    expect(dialog.textContent).not.toContain('on connection')
  })

  it('says a cluster outside the user scope in general words', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(409, { code: 'SOCLE_MISSING', error: 'the emergency stop is kept on connection c3: rule SSH 22 missing' })
    shared(() => stateOf(true, 'disabled'), () => stateOf(true, 'disabled'), [link('c1'), link('c2'), link('c3')])
    mock.routes[`GET ${C3}/status`] = () => reply(403, { code: 'FORBIDDEN', error: 'no' })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const dialog = await openResume()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }))

    expect(await within(dialog).findByText('Refused on another cluster of the policy.')).toBeTruthy()
    expect(dialog.textContent).not.toContain('c3')
  })
})

describe('the follow-up of the controls', () => {
  it('is dropped when the page moves to another connection', async () => {
    mock.routes['POST /emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    mock.routes['POST /api/v1/firewall/microseg/c2/emergency-stop'] = () => reply(200, { accepted: true, applied_by: 'self', on: true })
    const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    const { result, rerender } = renderHook(({ id }) => useMicrosegControls(id), { wrapper, initialProps: { id: 'c1' } })
    act(() => result.current.ask('stop'))
    await act(() => result.current.run())
    expect(result.current.followUp).toEqual({ on: true })
    rerender({ id: 'c2' })
    expect(result.current.followUp).toBeNull()
  })
})

describe('the stop of a policy of one cluster', () => {
  it('keeps its dialog and banner as they were: no cluster line, nothing listed after the stop', async () => {
    let stopped = false
    mock.routes['POST /emergency-stop'] = () => {
      stopped = true
      return reply(200, { accepted: true, applied_by: 'self', on: true })
    }
    mock.routes['GET /status'] = () => reply(200, stateOf(stopped, 'enabled'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    const dialog = await openStop()
    const policyReads = calls('GET /policy').length
    expect(within(dialog).queryByText(/Stops every cluster/)).toBeNull()
    expect(within(dialog).getByText('Every zone of this connection moves to observation.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency stop' }))
    expect(await screen.findByText('Emergency stop active: every zone is in observation')).toBeTruthy()
    expect(screen.queryByTestId('stop-follow')).toBeNull()
    // The policy is not read again for a policy of one cluster.
    expect(calls('GET /policy')).toHaveLength(policyReads)
  })
})
