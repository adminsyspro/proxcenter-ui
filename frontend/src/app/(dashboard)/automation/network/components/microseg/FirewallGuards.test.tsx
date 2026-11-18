/**
 * A shared policy over a cluster whose firewall is off: the plan dialog reads each cluster's checks once, says what it
 * finds on one line each and holds Apply back, a refused apply names the clusters, a failed run is said in plain words,
 * and the banner lists the clusters whose firewall is off with no emergency stop to explain it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'

import { calls, mock, policy, renderTab, reply, resetMocks, status, zone, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { failedWith, openPlanDialog, planRun, resetPlanMocks } from './planTestKit'

const C2 = '/api/v1/firewall/microseg/c2'
const C3 = '/api/v1/firewall/microseg/c3'
const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]

beforeEach(resetMocks)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const applyButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Apply' }) as HTMLButtonElement
const section = (dialog: HTMLElement, name: string) => within(dialog).getByRole('listitem', { name })

const OFF = { id: 'cluster_firewall', status: 'fail', fix: 'enable_cluster_firewall' }
const ON = { id: 'cluster_firewall', status: 'pass' }
const SERVICE_DOWN = { id: 'firewall_service', status: 'fail', detail: { nodes: ['pve2', 'pve3'] } }

describe('the plan dialog of a shared policy', () => {
  beforeEach(() => {
    resetPlanMocks()
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1', runs: [{ connection_id: 'c1', run_id: 'p1' }, { connection_id: 'c2', run_id: 'p2' }] })
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun(), id: 'p2', connection_id: 'c2' })
    mock.routes['GET /preflight'] = () => reply(200, { checks: [ON] })
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [ON] })
  })

  const openShared = async () => {
    renderTab(<MicrosegTab connectionId='c1' connectionName='PVE-PROD' connections={CONNECTIONS} />)
    fireEvent.click(await screen.findByRole('button', { name: /^(Review and apply|View plan)$/ }))
    return screen.findByRole('dialog', { name: 'Micro-segmentation plan' })
  }

  it('reads the checks of each cluster once, through its own relay, and says nothing when they are fine', async () => {
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(calls('GET /preflight')).toHaveLength(1)
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(1)
    expect(within(dialog).queryByTestId('plan-firewall-findings')).toBeNull()
  })

  it('says on one line that a cluster firewall is off, and holds Apply back with the cluster named on hover', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [OFF] })
    const dialog = await openShared()
    const dr = await waitFor(() => {
      const row = section(dialog, 'PVE-DR')
      expect(within(row).getByText('The cluster firewall is off: nothing would be filtered. Turn it on in Proxmox, then plan again.')).toBeTruthy()
      return row
    })
    expect(within(section(dialog, 'PVE-PROD').parentElement!).getAllByTestId('plan-firewall-findings')).toHaveLength(1)
    expect(within(dr).getByTestId('plan-firewall-findings')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
    fireEvent.mouseOver(applyButton(dialog).parentElement!)
    expect(await screen.findByText('Apply is unavailable: the cluster firewall is off on PVE-DR.')).toBeTruthy()
  })

  it('names a cluster outside the scope in general words in that reason', async () => {
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1', runs: [{ connection_id: 'c1', run_id: 'p1' }, { connection_id: 'c3', run_id: 'p3' }] })
    mock.routes[`GET ${C3}/runs/p3`] = () => reply(200, { ...planRun(), id: 'p3', connection_id: 'c3' })
    mock.routes[`GET ${C3}/preflight`] = () => reply(200, { checks: [OFF] })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(true))
    fireEvent.mouseOver(applyButton(dialog).parentElement!)
    const reason = await screen.findByText(/^Apply is unavailable/)
    expect(reason.textContent).toBe('Apply is unavailable: the cluster firewall is off on Another cluster.')
    expect(reason.textContent).not.toContain('c3')
  })

  it('warns, without blocking Apply, that the firewall service is stopped on nodes', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [ON, SERVICE_DOWN] })
    const dialog = await openShared()
    expect(await within(dialog).findByText('The firewall service is stopped on pve2, pve3: nothing is filtered on these nodes.')).toBeTruthy()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
  })

  it('does not count a cluster firewall the emergency stop holds off', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ ...OFF, detail: { held_by_stop: true } }] })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(1)
    expect(within(dialog).queryByTestId('plan-firewall-findings')).toBeNull()
  })

  it('shows nothing and does not block when the checks of a cluster cannot be read', async () => {
    mock.routes[`GET ${C2}/preflight`] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(within(dialog).queryByTestId('plan-firewall-findings')).toBeNull()
  })

  it('reads the checks again only when the plan is recomputed, never on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const dialog = await openShared()
      await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(calls(`GET ${C2}/preflight`)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the clusters of a refused apply and says what to do, nothing applied', async () => {
    mock.routes['POST /apply'] = () => reply(409, { code: 'CLUSTER_FIREWALL_OFF', error: 'cluster firewall disabled on connection c2: enable it before applying', connections: ['c2'] })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    fireEvent.click(applyButton(dialog))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('Nothing was applied: the cluster firewall is off on PVE-DR, so nothing would be filtered there. Turn it on in Proxmox, then plan again.')
    expect(alert.textContent).not.toContain('c2')
    expect(calls('POST /apply')).toHaveLength(1)
  })

  it('falls back on the IDs of the text of the refusal, and names an unknown cluster in general words', async () => {
    mock.routes['POST /apply'] = () => reply(409, { code: 'CLUSTER_FIREWALL_OFF', error: 'cluster firewall disabled on connection c2,c9: enable it before applying' })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    fireEvent.click(applyButton(dialog))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('is off on PVE-DR, Another cluster, so')
    expect(alert.textContent).not.toMatch(/c9/)
  })

  it('says in plain words, on the cluster line, that a run failed because its firewall was switched off', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1', runs: [{ connection_id: 'c1', run_id: 'a1' }, { connection_id: 'c2', run_id: 'a2' }] })
    mock.routes['GET /runs/a1'] = () => reply(200, { ...planRun(), id: 'a1', kind: 'apply' })
    mock.routes[`GET ${C2}/runs/a2`] = () => reply(200, { ...failedWith(planRun(), 'cluster firewall disabled on connection c2: enable it before applying'), id: 'a2', kind: 'apply', connection_id: 'c2', result: null })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    fireEvent.click(applyButton(dialog))
    const dr = await waitFor(() => {
      const row = section(dialog, 'PVE-DR')
      expect(within(row).getByText('The cluster firewall is off: nothing was applied here. Turn it on in Proxmox, then plan again.')).toBeTruthy()
      return row
    })
    expect(dr.textContent).not.toContain('enable it before applying')
  })
})

describe('a refused apply', () => {
  it('carries the connections of the 409 answer', async () => {
    mock.routes['POST /apply'] = () => reply(409, { code: 'CLUSTER_FIREWALL_OFF', error: 'cluster firewall disabled on connection c2: enable it before applying', connections: ['c2'] })
    const error = await microsegApi('c1').startApply(3).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(MicrosegApiError)
    expect((error as MicrosegApiError).code).toBe('CLUSTER_FIREWALL_OFF')
    expect((error as MicrosegApiError).connections).toEqual(['c2'])
    expect(calls('POST /apply')).toHaveLength(1)
  })
})

describe('the plan dialog of a policy with one cluster', () => {
  beforeEach(() => {
    resetPlanMocks()
    mock.routes['GET /preflight'] = () => reply(200, { checks: [ON] })
  })

  it('reads the checks once when the plan answers and says nothing when they are fine', async () => {
    const dialog = await openPlanDialog()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(calls('GET /preflight')).toHaveLength(1)
    expect(within(dialog).queryByTestId('plan-firewall-findings')).toBeNull()
  })

  it('says the cluster firewall is off on one line and holds Apply back with the reason on hover', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: [OFF] })
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('The cluster firewall is off: nothing would be filtered. Turn it on in Proxmox, then plan again.')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
    fireEvent.mouseOver(applyButton(dialog).parentElement!)
    expect(await screen.findByText(/^Apply is unavailable: the cluster firewall is off on /)).toBeTruthy()
  })

  it('warns about a stopped firewall service without blocking, and reads again on Recompute only', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: [ON, SERVICE_DOWN] })
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('The firewall service is stopped on pve2, pve3: nothing is filtered on these nodes.')).toBeTruthy()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(calls('GET /preflight')).toHaveLength(1)
  })

  it('shows nothing and does not block when the checks cannot be read', async () => {
    mock.routes['GET /preflight'] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    const dialog = await openPlanDialog()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(within(dialog).queryByTestId('plan-firewall-findings')).toBeNull()
  })
})

describe('the banner of a shared policy', () => {
  const engineOf = (cluster_firewall: 'enabled' | 'disabled') => ({ paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall })
  const link = (connection_id: string, stop_cluster_disabled = false) => ({ connection_id, active: true, stop_cluster_disabled, policy_id: 'p1', created_at: '', activated_at: null })

  function shared(c2: ReturnType<typeof status>, links = [link('c1'), link('c2')]) {
    resetMocks()
    mock.routes['GET /clusters'] = () => reply(200, { clusters: links, max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: links }))
    mock.routes['GET /status'] = () => reply(200, status({ engine: engineOf('enabled') }))
    mock.routes[`GET ${C2}/status`] = () => reply(200, c2)
    mock.routes[`GET ${C2}/drifts`] = () => reply(200, { drifts: [], computed: true })
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [], computed: true })
  }

  it('says on one line, with the cluster named, that its firewall is off and nothing is filtered', async () => {
    shared(status({ engine: engineOf('disabled') }))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    expect(await screen.findByText('PVE-DR: the cluster firewall is off, nothing is filtered there.')).toBeTruthy()
    expect(screen.queryByText(/^PVE-PROD: the cluster firewall is off/)).toBeNull()
  })

  it('leaves out a cluster the emergency stop or its link explains', async () => {
    shared(status({ engine: engineOf('disabled') }), [link('c1'), link('c2', true)])
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls(`GET ${C2}/status`).length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(screen.queryByText(/the cluster firewall is off, nothing is filtered there/)).toBeNull()
  })
})
