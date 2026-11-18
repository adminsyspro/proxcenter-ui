/**
 * The strip of runs under the banner: a run started on the Policy sub-tab stays
 * visible, and refreshes the policy and the status, whatever sub-tab is shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegRun } from '@/lib/microseg/types'

import { GUESTS_ROUTE, REVISION_HEAD, calls, mock, policy, reply } from './microsegTestKit'
import { db, installFreshMocks, run, setup, web } from './policyTestKit'

installFreshMocks()

const chooseState = async (zoneName: string, label: string) => {
  const row = await screen.findByRole('listitem', { name: zoneName })
  fireEvent.click(within(row).getByRole('button', { name: 'Change state' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: label }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

afterEach(() => {
  vi.useRealTimers()
})

describe('run strip', () => {
  it('keeps the line and refreshes the policy and the status when the sub-tab is switched mid-run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    let finish: (r: MicrosegRun) => void = () => undefined
    const pending = new Promise<MicrosegRun>(resolve => { finish = resolve })
    mock.routes['GET /runs/r1'] = async () => reply(200, await pending)
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/web: change to observation in progress/)).toBeTruthy()

    const policyReads = calls('GET /policy').length
    const statusReads = calls('GET /status').length
    const guestReads = calls(`GET ${GUESTS_ROUTE}`).length
    await act(async () => { finish(run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] })) })

    expect(await screen.findByText('web: 1 done, 0 failed, 0 not run')).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(policyReads))
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(statusReads))
    // The member counts come from the guest tags: the inventory is read again, no manual refresh needed.
    await waitFor(() => expect(calls(`GET ${GUESTS_ROUTE}`).length).toBeGreaterThan(guestReads))
  })

  it('keeps the first run line when a second state change starts', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['POST /zones/zd/state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    mock.routes['GET /runs/r2'] = () => reply(200, { ...run('running'), id: 'r2' })
    setup({ zones: [web({ state: 'disabled' }), db({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()
    await chooseState('db', 'Observe')
    expect(await screen.findByText(/db: change to observation in progress/)).toBeTruthy()
    expect(screen.getByText(/web: change to observation in progress/)).toBeTruthy()
  })

  it('removes a finished run after ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', { guests: 0, members: 0, steps: 0, drifts: 0 }))
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    expect(await screen.findByText('web: 0 done, 0 failed, 0 not run')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
    expect(screen.getByText('web: 0 done, 0 failed, 0 not run')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.queryByText('web: 0 done, 0 failed, 0 not run')).toBeNull()
  })

  it('lets a finished run be dismissed, and keeps a running one without a close button', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    const line = (await screen.findByText(/web: change to observation in progress/)).closest('[role="alert"]') as HTMLElement
    expect(within(line).queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('shows the counts of a failed run that carries its result', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, {
      ...run('failed', { guests: 1, members: 1, steps: 2, drifts: 0, done: [], failed: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's', error: 'locked' }], not_run: [{ index: 1, kind: 'guest.nic', object: 'g', summary: 's' }] }),
      error: '1 step(s) failed, 1 not run',
    })
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    expect(await screen.findByText('web: 0 done, 1 failed, 1 not run')).toBeTruthy()
  })

  it('dismisses a failed run with its close button', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('failed'))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    const line = (await screen.findByText('web: the run failed')).closest('[role="alert"]') as HTMLElement
    fireEvent.click(within(line).getByRole('button', { name: /close/i }))
    expect(screen.queryByText('web: the run failed')).toBeNull()
  })

  it('shows how far a running run is, then drops the bar once it has ended', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    let current: MicrosegRun = run('running', { progress: { phase: 'writing', done: 42, total: 99 } } as MicrosegRun['result'])
    mock.routes['GET /runs/r1'] = () => reply(200, current)
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    const line = (await screen.findByText(/web: change to observation in progress/)).closest('[role="alert"]') as HTMLElement
    const bar = await within(line).findByRole('progressbar', { name: /web: change to observation in progress/ })
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('42'))
    expect(within(line).getByText('writing to Proxmox, 42 / 99')).toBeTruthy()

    current = run('done', { guests: 1, members: 1, steps: 99, drifts: 0 })
    const ended = (await screen.findByText('web: 0 done, 0 failed, 0 not run', undefined, { timeout: 5_000 })).closest('[role="alert"]') as HTMLElement
    expect(within(ended).queryByRole('progressbar')).toBeNull()
  })
})

describe('run strip of a policy shared by several clusters', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const writing = (done: number, total: number) => run('running', { progress: { phase: 'writing', done, total } } as MicrosegRun['result'])

  it('shows one line per action, its bar summing the steps of every cluster, the clusters behind a chevron', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1', runs: [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', run_id: 'r2' }] })
    let first: MicrosegRun = writing(3, 10)
    let second: MicrosegRun = { ...writing(5, 10), id: 'r2', connection_id: 'c2' }
    mock.routes['GET /runs/r1'] = () => reply(200, first)
    mock.routes[`GET ${C2}/runs/r2`] = () => reply(200, second)
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    const line = (await screen.findByText(/web: change to observation in progress/)).closest('[role="alert"]') as HTMLElement
    expect(await within(line).findByText('writing to Proxmox, 8 / 20')).toBeTruthy()
    const bar = within(line).getByRole('progressbar', { name: /web: change to observation in progress/ })
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
    // Each cluster's run is read through its own cluster.
    expect(calls(`GET ${C2}/runs/r2`).length).toBeGreaterThan(0)

    const strip = screen.getByTestId('microseg-run-strip')
    // The bars only (the spinners of the line and of each cluster are progress bars too).
    const bars = () => within(strip).getAllByRole('progressbar').filter(el => el.className.includes('MuiLinearProgress'))
    expect(bars()).toHaveLength(1)
    fireEvent.click(within(strip).getByRole('button', { name: 'Show the clusters' }))
    await waitFor(() => expect(bars()).toHaveLength(3))

    first = run('done', { guests: 1, members: 1, steps: 1, drifts: 0, done: [{ index: 0, kind: 'guest.tags', object: 'g', summary: 's' }] })
    second = { ...run('failed'), id: 'r2', connection_id: 'c2', error: 'dial tcp: no route to host' }
    expect(await screen.findByText('web: done on 1 of 2 clusters', undefined, { timeout: 5_000 })).toBeTruthy()
  })

  it('keeps a single-cluster answer listing its run on one plain line', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1', runs: [{ connection_id: 'c1', run_id: 'r1' }] })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', { guests: 0, members: 0, steps: 0, drifts: 0 }))
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('web', 'Observe')
    expect(await screen.findByText('web: 0 done, 0 failed, 0 not run')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show the clusters' })).toBeNull()
  })

  it('ends the line when the run of a cluster cannot be read, lets it be closed and frees the zone', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1', runs: [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', run_id: 'r2' }] })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', { guests: 0, members: 0, steps: 0, drifts: 0 }))
    mock.routes[`GET ${C2}/runs/r2`] = () => reply(404, { code: 'NOT_FOUND', error: 'x' })
    setup({ zones: [web({ state: 'disabled' })] })

    await chooseState('web', 'Observe')
    const line = (await screen.findByText('web: done on 1 of 2 clusters')).closest('[role="alert"]') as HTMLElement
    expect(within(line).getByRole('button', { name: /close/i })).toBeTruthy()
    const row = screen.getByRole('listitem', { name: 'web' })
    await waitFor(() => expect((within(row).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(line).getByRole('button', { name: 'Show the clusters' }))
    expect(await within(line).findByText('This run cannot be read.')).toBeTruthy()
  })
})

describe('run strip with a cluster never applied', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const link = (connection_id: string, active: boolean) => ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })

  it('says on its line and in the headline to apply again once it is reachable, instead of a catch-up', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1', runs: [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', run_id: 'r2' }] })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', { guests: 1, members: 1, steps: 0, drifts: 0 }))
    mock.routes[`GET ${C2}/runs/r2`] = () => reply(200, { ...run('failed'), id: 'r2', connection_id: 'c2', error: 'request failed: dial tcp 10.0.0.2:8006: connect: no route to host' })
    setup({ zones: [web({ state: 'disabled' })] })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web({ state: 'disabled' })], last_revision: REVISION_HEAD, clusters: [link('c1', true), link('c2', false)] }))
    await screen.findByRole('listitem', { name: 'web' })
    await chooseState('web', 'Observe')
    const line = (await screen.findByText('web: done on 1 of 2 clusters, apply again once the cluster never applied is reachable', undefined, { timeout: 5_000 })).closest('[role="alert"]') as HTMLElement
    fireEvent.click(within(line).getByRole('button', { name: 'Show the clusters' }))
    expect(await within(line).findByText('This cluster was never applied: apply again once it is reachable.')).toBeTruthy()
    expect(within(line).queryByText(/reachable again/)).toBeNull()
  })
})
