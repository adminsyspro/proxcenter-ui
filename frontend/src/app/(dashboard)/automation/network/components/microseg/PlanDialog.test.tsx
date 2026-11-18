/**
 * The plan window: it computes the plan, shows the diff grouped by cluster
 * objects then by guest, warns, blocks on collisions and follows a stale plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, act, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { forgetSharedReads } from '@/lib/microseg/api'

import { calls, mock, policy, renderTab, reply, zone, REVISION_HEAD } from './microsegTestKit'
import { failedWith, g101, openPlanDialog, planRun, resetPlanMocks, step } from './planTestKit'
import MicrosegTab from './MicrosegTab'

beforeEach(() => resetPlanMocks())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const applyButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Apply' }) as HTMLButtonElement

describe('opening the plan', () => {
  it('opens from Review and apply, asks for a plan and shows progress while it computes', async () => {
    let finish: (r: unknown) => void = () => undefined
    const pending = new Promise(resolve => { finish = resolve })
    mock.routes['GET /runs/p1'] = async () => reply(200, await pending)

    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('Computing the plan from Proxmox...')).toBeTruthy()
    expect(calls('POST /plan')).toHaveLength(1)

    await act(async () => { finish(planRun()) })
    expect(await within(dialog).findByText('Cluster objects')).toBeTruthy()
    expect(within(dialog).queryByText('Computing the plan from Proxmox...')).toBeNull()
  })

  it('opens from the third step of the first run guide', async () => {
    mock.routes['GET /policy'] = () => reply(200, policy())
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'View plan' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation plan' })).toBeTruthy()
    expect(calls('POST /plan')).toHaveLength(1)
  })

  it('shows an error with a retry when the plan cannot be started', async () => {
    let up = false
    mock.routes['POST /plan'] = () => (up ? reply(202, { run_id: 'p1' }) : reply(503, { code: 'NOT_LEADER', error: 'x' }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('This orchestrator node is not the leader. Try again in a moment.')).toBeTruthy()

    up = true
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText('Cluster objects')).toBeTruthy()
    expect(calls('POST /plan')).toHaveLength(2)
  })

  it('shows a failed plan run with its plan, the failure and a recompute, and blocks Apply', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, failedWith(planRun(), 'cluster unreachable'))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('The plan could not be computed: cluster unreachable')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Recompute' })).toBeTruthy()
    expect(within(dialog).getByText('6 writes planned, 2 guests affected')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('shows only the failure when the failed run has no plan', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, { ...failedWith(planRun(), 'cluster unreachable'), result: null })
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('The plan could not be computed: cluster unreachable')).toBeTruthy()
    expect(within(dialog).queryByText('Cluster objects')).toBeNull()
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('keeps Retry on screen after a start error (the error cannot be dismissed into a blank window)', async () => {
    mock.routes['POST /plan'] = () => reply(503, { code: 'NOT_LEADER', error: 'x' })
    const dialog = await openPlanDialog()
    const alert = (await within(dialog).findByText('This orchestrator node is not the leader. Try again in a moment.')).closest('[role="alert"]') as HTMLElement
    expect(within(alert).queryByRole('button', { name: /close/i })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('the diff', () => {
  it('shows the write count, the cluster objects first, then one collapsed group per guest with its glyph', async () => {
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('6 writes planned, 2 guests affected')).toBeTruthy()

    const text = dialog.textContent ?? ''
    expect(text.indexOf('Cluster objects')).toBeLessThan(text.indexOf('web1'))
    expect(text.indexOf('web1')).toBeLessThan(text.indexOf('db1'))
    expect(within(dialog).getByText('Create ipset pcz-web')).toBeTruthy()
    expect(within(dialog).getByText('Create security group pcz-web')).toBeTruthy()

    expect(within(dialog).queryByText('Tag web1 with zone-web')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: /web1/ }))
    expect(await within(dialog).findByText('Tag web1 with zone-web')).toBeTruthy()
    expect(within(dialog).getByText('Turn the NIC firewall on for web1')).toBeTruthy()
    expect(within(dialog).getByText('3 steps')).toBeTruthy()
    // the group header carries the inventory glyph of the guest (qemu and lxc)
    expect(dialog.querySelector('i.ri-computer-fill')).toBeTruthy()
    expect(dialog.querySelector('i.ri-instance-fill')).toBeTruthy()
  })

  it('names a guest missing from the inventory by its type and id', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ plan: [step(0, 'guest.tags', 'Tag it', { node: 'pve9', type: 'qemu', vmid: 999 })], steps: 1 }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByRole('button', { name: /qemu\/999/ })).toBeTruthy()
  })

  it('pages the guests beyond twenty', async () => {
    const plan = Array.from({ length: 25 }, (_, i) => step(i, 'guest.tags', `Tag guest ${i}`, { node: 'pve1', type: 'qemu', vmid: 1000 + i }))
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ plan, steps: 25 }))
    const dialog = await openPlanDialog()
    await within(dialog).findByText('25 writes planned, 25 guests affected')

    expect(within(dialog).getAllByRole('button', { name: /qemu\/10\d\d/ })).toHaveLength(20)
    expect(within(dialog).getByText('1-20 of 25')).toBeTruthy()
    expect(dialog.querySelector('[role="list"]')?.textContent).not.toContain('1-20 of 25')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next page' }))
    expect(await within(dialog).findAllByRole('button', { name: /qemu\/10\d\d/ })).toHaveLength(5)
  })

  it('says there is nothing to change and disables Apply for an empty plan without pending changes', async () => {
    // nothing pending: the plan is opened from the first run guide
    mock.routes['GET /policy'] = () => reply(200, policy())
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ plan: [], steps: 0 }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('Nothing to change: Proxmox already matches the draft.')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
  })
})

describe('an empty plan with pending changes', () => {
  it('can still be applied: it records the revision', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ plan: [], steps: 0 }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText('Nothing to write in Proxmox: applying records the revision.')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(false)
  })
})

describe('warnings and collisions', () => {
  it('blocks the apply button when the plan has collisions', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ collisions: ['pcz-web', 'pcz-db'] }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText(/Blocked: .*pcz-web, pcz-db/)).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('warns about foreign rules, unread and ambiguous guests without blocking Apply', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, failedWith(planRun({
      foreign_rules: ['pcz-web:2'],
      unread: [g101],
      ambiguous: [{ node: 'pve2', type: 'lxc', vmid: 200 }],
    }), '1 guest(s) could not be read'))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText(/not touched: pcz-web:2/)).toBeTruthy()
    expect(within(dialog).getByText(/1 guest could not be read, they will be handled on the next pass: web1/)).toBeTruthy()
    expect(within(dialog).getByText(/1 guest is in several zones and will be left out: db1/)).toBeTruthy()
    expect(within(dialog).queryByText(/could not be computed/)).toBeNull()
    expect(applyButton(dialog).disabled).toBe(false)
  })

  it('keeps Apply blocked when unread guests come with a collision or another failure', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, failedWith(planRun({ unread: [g101], collisions: ['pcz-web'] }), '1 guest(s) could not be read'))
    const dialog = await openPlanDialog()
    await within(dialog).findByText(/Blocked/)
    expect(applyButton(dialog).disabled).toBe(true)
    cleanup()
    // A new window on another plan: the read of run p1 shared a second ago is not this one.
    forgetSharedReads()

    mock.routes['GET /runs/p1'] = () => reply(200, failedWith(planRun({ unread: [g101] }), 'save failed'))
    const again = await openPlanDialog()
    await within(again).findByText('The plan could not be computed: save failed')
    expect(applyButton(again).disabled).toBe(true)
  })

  it('shows no warning for a clean plan', async () => {
    const dialog = await openPlanDialog()
    await within(dialog).findByText('Cluster objects')
    expect(within(dialog).queryByText(/Blocked/)).toBeNull()
    expect(within(dialog).queryByText(/left out/)).toBeNull()
    expect(applyButton(dialog).disabled).toBe(false)
  })
})

describe('a plan of an older draft', () => {
  it('flags it, disables Apply and recomputes on request', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ version: 2 }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText(/older draft \(version 2, now 3\)/)).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)

    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p2' })
    mock.routes['GET /runs/p2'] = () => reply(200, { ...planRun({ version: 3 }), id: 'p2' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recompute' }))

    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(within(dialog).queryByText(/older draft/)).toBeNull()
    expect(calls('POST /plan')).toHaveLength(2)
  })

  it('reloads the policy when recomputing', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ version: 2 }))
    const dialog = await openPlanDialog()
    await within(dialog).findByText(/older draft/)
    const reads = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recompute' }))
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(reads))
  })

  it('treats a plan without a version as stale once the draft has one, and usable for draft 0', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ version: undefined }))
    const dialog = await openPlanDialog()
    expect(await within(dialog).findByText(/older draft/)).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
    cleanup()

    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, pending_changes: true, version: 0 }))
    const draftZero = await openPlanDialog()
    await within(draftZero).findByText('Cluster objects')
    expect(within(draftZero).queryByText(/older draft/)).toBeNull()
    expect(applyButton(draftZero).disabled).toBe(false)
  })
})

describe('closing', () => {
  it('closes from the Close button without applying anything', async () => {
    const dialog = await openPlanDialog()
    await within(dialog).findByText('Cluster objects')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Micro-segmentation plan' })).toBeNull())
    expect(calls('POST /apply')).toHaveLength(0)
  })
})

describe('a policy shared by several clusters', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
  const twoPlans = (second: Record<string, unknown> = { run_id: 'p2' }) => {
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1', runs: [{ connection_id: 'c1', run_id: 'p1' }, { connection_id: 'c2', ...second }] })
  }
  const openShared = async () => {
    renderTab(<MicrosegTab connectionId='c1' connectionName='PVE-PROD' connections={CONNECTIONS} />)
    fireEvent.click(await screen.findByRole('button', { name: /^(Review and apply|View plan)$/ }))
    return screen.findByRole('dialog', { name: 'Micro-segmentation plan' })
  }
  const section = (dialog: HTMLElement, name: string) => within(dialog).getByRole('listitem', { name })

  it('shows one section per cluster, with its chip, its step count and its status, the steps inside', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun({ plan: [step(0, 'ipset.create', 'Create ipset pcz-dr')], steps: 1 }), id: 'p2', connection_id: 'c2' })
    const dialog = await openShared()

    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    const prod = section(dialog, 'PVE-PROD')
    const dr = section(dialog, 'PVE-DR')
    expect(within(prod).getByText('6 steps')).toBeTruthy()
    expect(within(dr).getByText('1 step')).toBeTruthy()
    // Each cluster's plan is read through its own cluster.
    expect(calls('GET /runs/p1').length).toBeGreaterThan(0)
    expect(calls(`GET ${C2}/runs/p2`).length).toBeGreaterThan(0)

    expect(within(dr).queryByText('Create ipset pcz-dr')).toBeNull()
    fireEvent.click(within(dr).getByRole('button', { name: /PVE-DR/ }))
    expect(await within(dr).findByText('Create ipset pcz-dr')).toBeTruthy()
  })

  it('refuses the apply with the stale message when the plan of one cluster comes from an older draft', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun({ version: 2 }), id: 'p2', connection_id: 'c2' })
    const dialog = await openShared()
    expect(await within(dialog).findByText(/older draft \(version 2, now 3\)/)).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('keeps Apply disabled while the plan of a cluster is still computed', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun({}, 'running'), id: 'p2', connection_id: 'c2' })
    const dialog = await openShared()
    await within(section(dialog, 'PVE-PROD')).findByText('6 steps')
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('says an unreachable cluster will catch up, lists no step for it and still allows the apply', async () => {
    twoPlans({ error: 'no_client' })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    const dr = section(dialog, 'PVE-DR')
    expect(within(dr).getByText('Unreachable: it will catch up once it is reachable again.')).toBeTruthy()
    expect(within(dr).queryByText(/steps?$/)).toBeNull()
  })

  it('applies once, follows each cluster and says the application is partial when one cluster failed', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun(), id: 'p2', connection_id: 'c2' })
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1', runs: [{ connection_id: 'c1', run_id: 'a1' }, { connection_id: 'c2', run_id: 'a2' }] })
    mock.routes['GET /runs/a1'] = () => reply(200, { ...planRun({ done: [step(0, 'ipset.create', 'x')] }), id: 'a1', kind: 'apply' })
    mock.routes[`GET ${C2}/runs/a2`] = () => reply(200, { ...failedWith(planRun(), 'request failed: dial tcp 10.0.0.2:8006: connect: no route to host'), id: 'a2', kind: 'apply', connection_id: 'c2', result: null })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    fireEvent.click(applyButton(dialog))

    expect(await within(dialog).findByText('Applied on 1 of 2 clusters')).toBeTruthy()
    expect(calls('POST /apply')).toHaveLength(1)
    const dr = section(dialog, 'PVE-DR')
    expect(within(dr).getByText('Failed: it will be applied when the cluster is reachable again.')).toBeTruthy()
    fireEvent.click(within(dr).getByRole('button', { name: /PVE-DR/ }))
    expect(await within(dr).findByText('The apply run failed: request failed: dial tcp 10.0.0.2:8006: connect: no route to host')).toBeTruthy()
    expect(within(section(dialog, 'PVE-PROD')).getByText('1 done, 0 failed, 0 not run')).toBeTruthy()
  })

  it('renders an answer that lists a single cluster exactly as an answer without runs', async () => {
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1', runs: [{ connection_id: 'c1', run_id: 'p1' }] })
    const dialog = await openShared()
    expect(await within(dialog).findByText('6 writes planned, 2 guests affected')).toBeTruthy()
    expect(within(dialog).getByText('Cluster objects')).toBeTruthy()
    expect(within(dialog).queryByRole('listitem', { name: 'PVE-PROD' })).toBeNull()
    expect(within(dialog).queryByText(/of 1 cluster/)).toBeNull()
    expect(applyButton(dialog).disabled).toBe(false)
  })

  it('lets a cluster whose engine is stopped catch up later, but blocks the apply on an internal start error and says why', async () => {
    twoPlans({ error: 'engine_stopped' })
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    expect(within(section(dialog, 'PVE-DR')).getByText('The engine is stopped on this cluster.')).toBeTruthy()
    cleanup()
    forgetSharedReads()

    twoPlans({ error: 'internal' })
    const again = await openShared()
    await within(section(again, 'PVE-PROD')).findByText('6 steps')
    expect(within(section(again, 'PVE-DR')).getByText('The plan could not start on this cluster: recompute before applying.')).toBeTruthy()
    expect(applyButton(again).disabled).toBe(true)
  })

  it('stops computing a cluster whose plan cannot be read, says so and blocks the apply', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(403, { code: 'FORBIDDEN', error: 'x' })
    const dialog = await openShared()
    const dr = section(dialog, 'PVE-DR')
    expect(await within(dr).findByText('The plan of this cluster cannot be read: recompute before applying.')).toBeTruthy()
    expect(within(dr).queryByText('Computing')).toBeNull()
    await within(section(dialog, 'PVE-PROD')).findByText('6 steps')
    expect(applyButton(dialog).disabled).toBe(true)
  })

  const applyBoth = async (second: () => unknown) => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun(), id: 'p2', connection_id: 'c2' })
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1', runs: [{ connection_id: 'c1', run_id: 'a1' }, { connection_id: 'c2', run_id: 'a2' }] })
    mock.routes['GET /runs/a1'] = () => reply(200, { ...planRun({ done: [step(0, 'ipset.create', 'x')] }), id: 'a1', kind: 'apply' })
    mock.routes[`GET ${C2}/runs/a2`] = second
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    fireEvent.click(applyButton(dialog))
    return dialog
  }

  it('ends the application of a cluster whose run cannot be read, and still gives the headline', async () => {
    const dialog = await applyBoth(() => reply(403, { code: 'FORBIDDEN', error: 'x' }))
    expect(await within(dialog).findByText('Applied on 1 of 2 clusters')).toBeTruthy()
    expect(within(section(dialog, 'PVE-DR')).getByText('This run cannot be read.')).toBeTruthy()
  })

  it('says a cluster will catch up only when its run failed to reach it; another failure is a plain failure', async () => {
    const dialog = await applyBoth(() => reply(200, { ...failedWith(planRun(), '1 step(s) failed, 0 not run'), id: 'a2', kind: 'apply', connection_id: 'c2' }))
    expect(await within(dialog).findByText('Applied on 1 of 2 clusters')).toBeTruthy()
    const dr = section(dialog, 'PVE-DR')
    expect(within(dr).getByText('Failed.')).toBeTruthy()
    expect(within(dr).queryByText(/reachable again/)).toBeNull()
    fireEvent.click(within(dr).getByRole('button', { name: /PVE-DR/ }))
    expect(await within(dr).findByText('The apply run failed: 1 step(s) failed, 0 not run')).toBeTruthy()
  })
  const LAB_UNREACHABLE = 'read the guests: GET /cluster/resources?type=vm: request failed: all 3 cluster nodes unreachable (last error: dial tcp 10.42.0.111:8006: connect: connection refused)'
  const failedPlan = (error: string) => () => reply(200, { ...failedWith({ ...planRun(), result: null }, error), id: 'p2', connection_id: 'c2' })

  it('applies on the reachable clusters when the plan of one ended failed because it could not be reached, and says it catches up', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = failedPlan(LAB_UNREACHABLE)
    const dialog = await openShared()
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false))
    const dr = section(dialog, 'PVE-DR')
    expect(within(dr).getByText('Unreachable: it will be applied when the cluster is reachable again.')).toBeTruthy()
    expect(within(dr).queryByText(/steps?$/)).toBeNull()
    expect(within(dialog).queryByText(/Apply is unavailable/)).toBeNull()
    // The raw error names node addresses of that cluster: only inside its own section.
    fireEvent.click(within(dr).getByRole('button', { name: /PVE-DR/ }))
    expect(await within(dr).findByText(`The plan could not be computed: ${LAB_UNREACHABLE}`)).toBeTruthy()
    expect(within(section(dialog, 'PVE-PROD')).queryByText(/10\.42\.0\.111/)).toBeNull()
  })

  it('blocks the apply on any other failed plan, gives the reason in its section and says why Apply is disabled', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = failedPlan('save the revision: duplicate key')
    const dialog = await openShared()
    await within(section(dialog, 'PVE-PROD')).findByText('6 steps')
    const dr = section(dialog, 'PVE-DR')
    expect(await within(dr).findByText('The plan could not be computed: save the revision: duplicate key')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
    expect(within(dialog).getByText('Apply is unavailable: the plan of a cluster failed. Open its section for the reason, then recompute.')).toBeTruthy()
  })

  it('keeps Apply disabled and says why when no cluster could be planned', async () => {
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1', runs: [{ connection_id: 'c1', error: 'no_client' }, { connection_id: 'c2', run_id: 'p2' }] })
    mock.routes[`GET ${C2}/runs/p2`] = failedPlan(LAB_UNREACHABLE)
    const dialog = await openShared()
    expect(await within(dialog).findByText('Apply is unavailable: no cluster could be reached to compute the plan.')).toBeTruthy()
    expect(applyButton(dialog).disabled).toBe(true)
  })

  it('says why Apply is disabled when a plan of a cluster comes from an older draft', async () => {
    twoPlans()
    mock.routes[`GET ${C2}/runs/p2`] = () => reply(200, { ...planRun({ version: 2 }), id: 'p2', connection_id: 'c2' })
    const dialog = await openShared()
    expect(await within(dialog).findByText('Apply is unavailable: recompute the plan, it comes from an older draft.')).toBeTruthy()
  })
  describe('a cluster never applied', () => {
    const NEVER = 'This cluster was never applied: apply again once it is reachable.'
    const withInactive = () => {
      mock.routes['GET /policy'] = () => reply(200, policy({
        zones: [zone('a')], last_revision: REVISION_HEAD, pending_changes: true,
        clusters: [
          { connection_id: 'c1', active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '2026-11-01T10:00:00Z', activated_at: null },
          { connection_id: 'c2', active: false, stop_cluster_disabled: false, policy_id: 'p1', created_at: '2026-11-01T10:00:00Z', activated_at: null },
        ],
      }))
    }

    it('says to apply again, not that it catches up, when its plan could not reach it or did not start for no_client', async () => {
      withInactive()
      twoPlans()
      mock.routes[`GET ${C2}/runs/p2`] = failedPlan(LAB_UNREACHABLE)
      const dialog = await openShared()
      expect(await within(section(dialog, 'PVE-DR')).findByText(NEVER)).toBeTruthy()
      expect(within(dialog).queryByText(/reachable again/)).toBeNull()
      cleanup()
      forgetSharedReads()

      withInactive()
      twoPlans({ error: 'no_client' })
      const again = await openShared()
      expect(await within(section(again, 'PVE-DR')).findByText(NEVER)).toBeTruthy()
      expect(within(again).queryByText(/catch up/)).toBeNull()
    })

    it('says to apply again on its line and in the headline when its application could not reach it', async () => {
      withInactive()
      const dialog = await applyBoth(() => reply(200, { ...failedWith(planRun(), 'request failed: dial tcp 10.0.0.2:8006: connect: no route to host'), id: 'a2', kind: 'apply', connection_id: 'c2', result: null }))
      expect(await within(dialog).findByText('Applied on 1 of 2 clusters: apply again once the cluster never applied is reachable.')).toBeTruthy()
      expect(within(section(dialog, 'PVE-DR')).getByText(NEVER)).toBeTruthy()
      expect(within(dialog).queryByText(/reachable again/)).toBeNull()
    })
  })
})
