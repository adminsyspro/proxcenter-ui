/**
 * Applying from the plan window: the apply run is followed by polling, kept in
 * the strip after the window is closed, and its outcome is shown per guest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, act, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply } from './microsegTestKit'
import { PLAN_STEPS, applyRun, failedWith, g101, g200, openPlanDialog, planRun, resetPlanMocks, step } from './planTestKit'
import { body } from './policyTestKit'

beforeEach(() => resetPlanMocks())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const clickApply = async (dialog: HTMLElement) => {
  const button = await within(dialog).findByRole('button', { name: 'Apply' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}

describe('applying', () => {
  it('sends the current draft version and shows the progress', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, applyRun({}, 'running'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)

    expect(await within(dialog).findByText('Applying the plan to Proxmox...')).toBeTruthy()
    expect(body(calls('POST /apply')[0][1] as RequestInit)).toEqual({ version: 3 })
    expect(within(dialog).queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('follows a long apply run by polling, never by a long request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    let released = false
    mock.routes['GET /runs/a1'] = () => reply(200, released ? applyRun({ done: [step(0, 'ipset.create', 'Create ipset pcz-web')] }) : applyRun({}, 'running'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    await within(dialog).findByText('Applying the plan to Proxmox...')

    // The window and the strip each read the run every 2 s (their reads at the same moment share one request):
    // short requests, none waits for the end of the run.
    const readsBefore = calls('GET /runs/a1').length
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(calls('GET /runs/a1').length).toBeGreaterThanOrEqual(readsBefore + 2)
    expect(within(dialog).getByText('Applying the plan to Proxmox...')).toBeTruthy()

    released = true
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(await within(dialog).findByText('1 done, 0 failed, 0 not run')).toBeTruthy()
    expect(calls('POST /apply')).toHaveLength(1)
  })

  it('keeps the apply run in the strip after the window is closed, and refreshes the policy and status when it ends', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    let finish: (r: unknown) => void = () => undefined
    const pending = new Promise(resolve => { finish = resolve })
    let ended = false
    mock.routes['GET /runs/a1'] = async () => (ended ? reply(200, await pending) : reply(200, applyRun({}, 'running')))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    await within(dialog).findByText('Applying the plan to Proxmox...')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Micro-segmentation plan' })).toBeNull())
    expect(await screen.findByText('Plan apply in progress')).toBeTruthy()

    const policyReads = calls('GET /policy').length
    const statusReads = calls('GET /status').length
    ended = true
    await act(async () => { finish(applyRun({ done: [step(0, 'ipset.create', 'x')] })) })
    expect(await screen.findByText('Apply: 1 done, 0 failed, 0 not run', {}, { timeout: 5_000 })).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(statusReads))
  })
})

describe('applying: errors', () => {
  it('reloads the policy and asks to recompute when the draft moved (409)', async () => {
    mock.routes['POST /apply'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const dialog = await openPlanDialog()
    await within(dialog).findByText('Cluster objects')
    const policyReads = calls('GET /policy').length
    await clickApply(dialog)

    expect(await within(dialog).findByText('The draft changed while you were reviewing. Recompute the plan.')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    expect((within(dialog).queryByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)

    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p2' })
    mock.routes['GET /runs/p2'] = () => reply(200, { ...applyRun({}), id: 'p2', kind: 'plan' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recompute' }))
    await waitFor(() => expect(within(dialog).queryByText(/Recompute the plan/)).toBeNull())
    expect(calls('POST /plan')).toHaveLength(2)
  })

  it('shows a translated message when another operation is running (BUSY)', async () => {
    mock.routes['POST /apply'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('Another operation is running on this connection. Try again in a moment.')).toBeTruthy()
    expect(calls('GET /runs/a1')).toHaveLength(0)
  })

  it('shows the error of an apply run that failed', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, { ...applyRun({}, 'failed'), error: 'lost the leader lock' })
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('The apply run failed: lost the leader lock')).toBeTruthy()
  })
})

describe('applying: the result', () => {
  it('shows failed steps per guest with their reasons, and the steps not run', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, failedWith(applyRun({
      done: [step(0, 'ipset.create', 'Create ipset pcz-web'), step(1, 'group.create', 'Create security group pcz-web')],
      failed: [step(2, 'guest.tags', 'Tag web1 with zone-web', g101, 'guest is locked')],
      not_run: [step(5, 'guest.tags', 'Tag db1 with zone-db', g200, 'skipped after the failure on this node')],
    }), '1 step(s) failed, 1 not run'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)

    expect(await within(dialog).findByText('The apply run failed: 1 step(s) failed, 1 not run')).toBeTruthy()
    expect(await within(dialog).findByText('2 done, 1 failed, 1 not run')).toBeTruthy()
    expect(within(dialog).getByText('Failed steps')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /web1/ }))
    expect(await within(dialog).findByText('Tag web1 with zone-web')).toBeTruthy()
    expect(within(dialog).getByText('guest is locked')).toBeTruthy()

    expect(within(dialog).getByText('Steps not run')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /db1/ }))
    expect(await within(dialog).findByText('skipped after the failure on this node')).toBeTruthy()
  })

  it('keeps the plan on screen while it is applied and checks each step as the engine writes it', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, { ...applyRun({}, 'running'), result: { progress: { phase: 'writing', done: 3, total: 6 } } })
    const dialog = await openPlanDialog()
    await clickApply(dialog)

    const state = (testId: string) => within(dialog).getByTestId(testId).querySelector('[data-step-state]')?.getAttribute('data-step-state')
    // The cluster group is open: its two steps are written.
    await waitFor(() => expect(state('plan-step-0')).toBe('done'))
    expect(state('plan-step-1')).toBe('done')
    const cluster = within(dialog).getByRole('listitem', { name: 'Cluster objects' })
    expect(cluster.textContent).toContain('2 / 2')
    expect(within(cluster).getAllByRole('img', { name: 'Done' }).length).toBeGreaterThan(0)
    // web1: one step of three written, the next being written; db1 waits.
    const web1 = within(dialog).getByRole('listitem', { name: 'web1' })
    expect(web1.textContent).toContain('1 / 3')
    expect(within(web1).getByRole('img', { name: 'Being written' })).toBeTruthy()
    fireEvent.click(within(web1).getByRole('button', { name: /web1/ }))
    await waitFor(() => expect(state('plan-step-3')).toBe('running'))
    expect(state('plan-step-2')).toBe('done')
    expect(state('plan-step-4')).toBe('waiting')
    expect(within(dialog).getByRole('listitem', { name: 'db1' }).textContent).toContain('0 / 1')
  })

  it('leaves each step with its outcome once the application has ended, the reason of a failure on its line', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, failedWith(applyRun({
      done: PLAN_STEPS.slice(0, 4), failed: [{ ...PLAN_STEPS[4], error: 'guest is locked' }], not_run: [{ ...PLAN_STEPS[5], error: 'skipped after the failure' }],
    }), '1 step(s) failed, 1 not run'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)

    expect(await within(dialog).findByText('4 done, 1 failed, 1 not run')).toBeTruthy()
    // Every step is listed once, with its mark: the separate sections of failed and skipped steps are not repeated.
    expect(within(dialog).queryByText('Failed steps')).toBeNull()
    expect(within(dialog).queryByText('Steps not run')).toBeNull()
    const web1 = within(dialog).getByRole('listitem', { name: 'web1' })
    expect(web1.textContent).toContain('2 / 3')
    expect(within(web1).getByRole('img', { name: 'Failed' })).toBeTruthy()
    fireEvent.click(within(web1).getByRole('button', { name: /web1/ }))
    expect(await within(dialog).findByText('guest is locked')).toBeTruthy()
    expect(within(within(dialog).getByRole('listitem', { name: 'db1' })).getByRole('img', { name: 'Not run' })).toBeTruthy()
  })

  it('shows the truncated notice when the write cap stopped the run', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, failedWith(applyRun({ truncated: true, not_run: [step(5, 'guest.tags', 'Tag db1', g200)] }), '0 step(s) failed, 1 not run'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('The run stopped at its write limit, the remaining steps were not run.')).toBeTruthy()
  })

  it('shows the interrupted notice of a run stopped by the emergency stop', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, failedWith(applyRun({ interrupted: true, not_run: [step(5, 'guest.tags', 'Tag db1', g200)] }), 'interrupted by the emergency stop'))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('The apply run failed: interrupted by the emergency stop')).toBeTruthy()
    expect(within(dialog).getByText('The run was interrupted, the remaining steps were not run.')).toBeTruthy()
    expect(within(dialog).getByText('0 done, 0 failed, 1 not run')).toBeTruthy()
  })

  it('shows the held notice', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, applyRun({ held: true }))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('Nothing was written: writes are on hold. Confirm them in the banner, then apply again.')).toBeTruthy()
  })

  it('applies an empty plan to record the revision', async () => {
    mock.routes['GET /runs/p1'] = () => reply(200, planRun({ plan: [], steps: 0 }))
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, applyRun({ plan: [], steps: 0 }))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    expect(await within(dialog).findByText('0 done, 0 failed, 0 not run')).toBeTruthy()
    expect(body(calls('POST /apply')[0][1] as RequestInit)).toEqual({ version: 3 })
  })

  it('shows no notice for a clean run', async () => {
    mock.routes['POST /apply'] = () => reply(202, { run_id: 'a1' })
    mock.routes['GET /runs/a1'] = () => reply(200, applyRun({ done: [step(0, 'ipset.create', 'x')] }))
    const dialog = await openPlanDialog()
    await clickApply(dialog)
    await within(dialog).findByText('1 done, 0 failed, 0 not run')
    expect(within(dialog).queryByText(/write limit|interrupted|on hold|Failed steps|Steps not run/)).toBeNull()
  })
})

